"""Provider-agnostic LLM wrapper. Provider and model come from environment variables, so the
model can be swapped without a code change.

    LLM_PROVIDER             claude_code (default, the only provider built)
    LLM_MODEL                optional model alias or id, e.g. sonnet or haiku; empty = the CLI's default
    LLM_MAX_CALLS            hard cap on requests per run (default 14)
    CLAUDE_CODE_OAUTH_TOKEN  Claude subscription token made with `claude setup-token`

The claude_code provider runs the Claude Code CLI in print mode (`claude -p`) with every tool
switched off, so each call is one plain question and one answer. GitHub Models, the brief's
first choice, was retired on 30 July 2026.

Every request counts against the cap, including the retry after a rate limit.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from typing import Callable, Dict

DEFAULT_PROVIDER = "claude_code"
DEFAULT_MAX_CALLS = 14
CALL_TIMEOUT = 240           # seconds per call
RATE_LIMIT_WAIT = 30         # seconds before the one retry after a rate limit

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")
_OBJECT = re.compile(r"\{.*\}", re.S)
_AUTH = re.compile(r"invalid api key|authenticat|unauthori[sz]ed|oauth|log ?in|credential|401|403", re.I)
_QUOTA = re.compile(r"usage limit|limit reached|quota|out of (extra )?usage|billing", re.I)
_RATE = re.compile(r"rate.?limit|overloaded|429|529", re.I)


class LLMError(Exception):
    """Any failure of the LLM step: timeout, rate limit, unreadable reply."""


class LLMFatal(LLMError):
    """A failure that a retry cannot fix: no token, CLI missing, access refused, plan limit, call cap."""


class _RateLimited(Exception):
    pass


def _claude_code_ready() -> None:
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip():
        raise LLMFatal("CLAUDE_CODE_OAUTH_TOKEN is not set")


def _claude_code(model: str, system: str, user: str, max_tokens: int) -> str:
    """One call through the Claude Code CLI. `max_tokens` is not used: the CLI sets its own."""
    command = ["claude", "-p", "--output-format", "json", "--system-prompt", system,
               "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence"]
    if model:
        command += ["--model", model]
    try:
        with tempfile.TemporaryDirectory() as empty:  # nothing of the repo is in reach of the call
            done = subprocess.run(command, input=user, capture_output=True, text=True,
                                  timeout=CALL_TIMEOUT, cwd=empty)
    except FileNotFoundError:
        raise LLMFatal("the claude CLI is not installed")
    except subprocess.TimeoutExpired:
        raise LLMError(f"no reply within {CALL_TIMEOUT}s")
    try:
        reply = json.loads(done.stdout)
    except ValueError:
        reply = {}
    text = reply.get("result") if isinstance(reply, dict) else None
    failed = done.returncode != 0 or not isinstance(reply, dict) or reply.get("is_error") or not isinstance(text, str)
    if failed:
        detail = " ".join(str(part) for part in (text, done.stderr.strip(), done.stdout.strip()[:300]) if part)[:400]
        if _AUTH.search(detail) or _QUOTA.search(detail):
            raise LLMFatal(f"claude CLI refused the call: {detail}")
        if _RATE.search(detail):
            raise _RateLimited()
        raise LLMError(f"claude CLI failed (exit {done.returncode}): {detail}")
    return text


# name -> (check that runs before a call is counted, the call itself)
PROVIDERS: Dict[str, tuple] = {
    "claude_code": (_claude_code_ready, _claude_code),
}


class LLM:
    def __init__(self) -> None:
        self.provider = os.environ.get("LLM_PROVIDER", "").strip() or DEFAULT_PROVIDER
        self.model = os.environ.get("LLM_MODEL", "").strip()  # empty = the provider's default
        self.max_calls = int(os.environ.get("LLM_MAX_CALLS", "").strip() or DEFAULT_MAX_CALLS)
        self.calls = 0

    def _request(self, system: str, user: str, max_tokens: int) -> str:
        if self.provider not in PROVIDERS:
            raise LLMFatal(f"unknown LLM_PROVIDER '{self.provider}'")
        ready, call = PROVIDERS[self.provider]
        ready()
        if self.calls >= self.max_calls:
            raise LLMFatal(f"call cap reached ({self.max_calls} per run)")
        self.calls += 1  # counts requests actually sent
        return call(self.model, system, user, max_tokens)

    def complete_json(self, system: str, user: str, max_tokens: int = 2000) -> dict:
        """One call that must return a JSON object. Waits out one rate limit."""
        try:
            content = self._request(system, user, max_tokens)
        except _RateLimited:
            time.sleep(RATE_LIMIT_WAIT)
            try:
                content = self._request(system, user, max_tokens)
            except _RateLimited:
                raise LLMError("rate limited twice")
        content = _FENCE.sub("", content.strip())
        try:
            data = json.loads(content)
        except ValueError:
            found = _OBJECT.search(content)  # tolerate a sentence before or after the object
            try:
                data = json.loads(found.group(0)) if found else None
            except ValueError:
                data = None
        if not isinstance(data, dict):
            raise LLMError("reply was not a JSON object")
        return data
