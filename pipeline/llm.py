"""Provider-agnostic LLM wrapper. Provider and model come from environment variables, so the
cheapest adequate model can be swapped in without a code change.

    LLM_PROVIDER    github_models (default, the only provider built so far)
    LLM_MODEL       model id, e.g. openai/gpt-4.1-mini
    LLM_MAX_CALLS   hard cap on requests per run (default 14)
    GITHUB_TOKEN    the Actions token, with `models: read` permission

Every request counts against the cap, including retries after a rate limit.
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Callable, Dict

import httpx

DEFAULT_PROVIDER = "github_models"
DEFAULT_MODEL = "openai/gpt-4.1-mini"
DEFAULT_MAX_CALLS = 14
GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions"
TIMEOUT = httpx.Timeout(90.0, connect=10.0)
MAX_RATE_LIMIT_WAIT = 65  # seconds; longer waits are treated as a failure

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


class LLMError(Exception):
    """Any failure of the LLM step: HTTP error, rate limit, unreadable reply."""


class LLMFatal(LLMError):
    """A failure that a retry cannot fix: no token, unknown provider, access refused, call cap reached."""


def _github_models(model: str, system: str, user: str, max_tokens: int) -> str:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        raise LLMFatal("GITHUB_TOKEN is not set")
    response = httpx.post(
        GITHUB_MODELS_URL,
        timeout=TIMEOUT,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        },
    )
    if response.status_code == 429:
        raise _RateLimited(response.headers.get("retry-after", ""))
    if response.status_code in (401, 403):
        raise LLMFatal(f"HTTP {response.status_code}: {response.text[:300]}")
    if response.status_code >= 400:
        raise LLMError(f"HTTP {response.status_code}: {response.text[:300]}")
    try:
        return response.json()["choices"][0]["message"]["content"] or ""
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"unexpected response shape: {exc}")


class _RateLimited(Exception):
    def __init__(self, retry_after: str):
        self.seconds = int(retry_after) if retry_after.isdigit() else 30


PROVIDERS: Dict[str, Callable[[str, str, str, int], str]] = {
    "github_models": _github_models,
}


class LLM:
    def __init__(self) -> None:
        self.provider = os.environ.get("LLM_PROVIDER", "").strip() or DEFAULT_PROVIDER
        self.model = os.environ.get("LLM_MODEL", "").strip() or DEFAULT_MODEL
        self.max_calls = int(os.environ.get("LLM_MAX_CALLS", "").strip() or DEFAULT_MAX_CALLS)
        self.calls = 0

    def _request(self, system: str, user: str, max_tokens: int) -> str:
        if self.provider not in PROVIDERS:
            raise LLMFatal(f"unknown LLM_PROVIDER '{self.provider}'")
        if self.provider == "github_models" and not os.environ.get("GITHUB_TOKEN", "").strip():
            raise LLMFatal("GITHUB_TOKEN is not set")
        if self.calls >= self.max_calls:
            raise LLMFatal(f"call cap reached ({self.max_calls} per run)")
        self.calls += 1  # counts requests actually sent
        try:
            return PROVIDERS[self.provider](self.model, system, user, max_tokens)
        except httpx.HTTPError as exc:
            raise LLMError(type(exc).__name__)

    def complete_json(self, system: str, user: str, max_tokens: int = 2000) -> dict:
        """One chat call that must return a JSON object. Waits out one rate limit."""
        try:
            content = self._request(system, user, max_tokens)
        except _RateLimited as limited:
            if limited.seconds > MAX_RATE_LIMIT_WAIT:
                raise LLMError(f"rate limited for {limited.seconds}s")
            time.sleep(limited.seconds + 1)
            try:
                content = self._request(system, user, max_tokens)
            except _RateLimited:
                raise LLMError("rate limited twice")
        try:
            data = json.loads(_FENCE.sub("", content.strip()))
        except ValueError:
            raise LLMError("reply was not valid JSON")
        if not isinstance(data, dict):
            raise LLMError("reply was not a JSON object")
        return data
