# daily-brief

A personal daily brief: 10–11 stories across five topics, then a short quiz. The full plan is in [BRIEF.md](BRIEF.md).

**Status:** session 2 of 4 done (content and automation). A GitHub Actions job runs at 06:00 UTC, fetches 37 sources, picks the stories, writes summaries and a quiz with GitHub Models, and commits the day's brief as JSON. There is no app yet (session 3).

**Not yet proven:** the summaries and quiz have never run against a real model. On 11 Nov GitHub Models was not serving its API (see "First run" below), so every test run published the headlines-only fallback. Run the workflow as a dry run once GitHub Models answers again, and check the output before relying on the 06:00 job.

Decisions from review are recorded at the end of [BRIEF.md](BRIEF.md).

## Run it

**In GitHub (the normal way):** Actions → Daily brief → Run workflow. Tick "Dry run" to build the brief without committing it or sending a push; the result is then in the run's log and its `out` artifact.

**Locally:**

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python -m pipeline.run --dry-run
```

| Flag | Effect |
| --- | --- |
| (none) | Writes `data/daily/YYYY-MM-DD.json`, updates `data/archive/YYYY-MM.json`, prunes old daily files |
| `--dry-run` | Writes `out/brief-YYYY-MM-DD.json` only; `data/` is not touched |
| `--no-llm` | Skips summaries and quiz: headlines-only brief |
| `--print-brief` | Also prints the finished brief JSON |
| `--quiet` | No ranking report |

Every run prints the ranking report and saves `out/ranked-YYYY-MM-DD.json`. The `out/` folder is not committed. Without a `GITHUB_TOKEN` that can read GitHub Models, a local run produces a headlines-only brief, which is the fallback working as designed.

The code runs on Python 3.9 and later; GitHub Actions uses 3.12, as the brief specifies.

## What session 2 built

| Pipeline step | Where | What it does |
| --- | --- | --- |
| 1. Trigger | `.github/workflows/daily.yml` | Cron at 06:00 UTC plus the "Run workflow" button, with a dry-run option |
| 5. Summarise | `pipeline/summarise.py`, `prompts/summary.txt`, `prompts/summary_macro.txt` | One LLM call per topic: 3-sentence summary, "why it matters" line and primer concept tag per story. Macro also gets a "how this can be accessed" note per story and the daily market idea |
| 6. Quiz | `pipeline/quiz.py`, `prompts/quiz.txt` | One LLM call: one 4-option question per summarised story and one on the market idea |
| 7. Validate | `pipeline/validate.py`, `pipeline/models.py` | Content checks on every summary and question, one retry, then the fallback. The finished brief is checked against the `DailyBrief` schema before it is written |
| 8. Write and prune | `pipeline/output.py` | Writes the daily file, adds the quiz and links to the monthly archive, deletes daily files more than 7 days old |
| 9. Notify | `pipeline/notify.py` | ntfy.sh push after the commit. Deploying to Pages is session 3 |
| LLM wrapper | `pipeline/llm.py` | Provider and model from environment variables; hard cap on calls per run |

How the LLM step behaves:

- **Calls per run:** 6 when all goes well (5 topics plus the quiz), 12 at most with retries. The cap is 14 (`LLM_MAX_CALLS`).
- **Feed text only:** stories from headline-only sources (FT Alphaville, WSJ, The Economist, Foreign Policy, Hacker News) and stories with under 80 characters of feed text are never sent to the LLM. They appear as headline and link, with no quiz question.
- **Answer stated in the summary:** each question must quote, word for word, the part of the summary, "why it matters" line or access note that states its answer. A question whose quote is not found, or whose correct option uses a number that is not in that text, is rejected.
- **Retry and fallback:** a failed topic call or rejected item gets one retry with the reasons attached. After that, only what failed degrades: the story stays headline and link, or the question is dropped. If nothing can be summarised (no token, GitHub Models down, any crash in the LLM step), the brief is still published as headlines only.
- **Status:** each brief is marked `full`, `partial` or `headlines_only`, and lists what degraded under `issues`.
- **Answer order:** options are shuffled in code, so the correct answer is not always in the same place.
- **Concept tags:** the list of primer concepts per topic is in `config/topics.yaml` (`concepts`), taken from the brief's Foundations column. Session 4 writes one card per id. Top headlines has none.
- **Review queue:** not added by the pipeline. Which questions were missed is known only on the phone, so the app (session 3) draws review questions from the archive.

## First run (11 Nov 2026)

Six dry runs in GitHub Actions from the session branch, on Python 3.12: five from a temporary push trigger (since removed) and one manual run.

| Step | Result |
| --- | --- |
| Fetch | 36 of 37 sources returned items. Import AI returns 403 to GitHub's runners every time. On the first run Insurance Journal (both feeds) and Carrier Management timed out, then worked on later runs |
| Filter and rank | 10 stories across all five topics, 2 per topic |
| Summaries and quiz | Not tested. `models.github.ai` answered every request with HTTP 200 and the plain text "OK": any path, with or without a token, and the same for GitHub's own `actions/ai-inference` action. That points to GitHub's side, not this repo's token or code |
| Fallback | Worked each time: a schema-valid headlines-only brief with the reason listed under `issues` |
| Commit, prune and ntfy push | Not tested: dry runs skip them. The first real run on main is their first test |
| Manual run with "Dry run" ticked | Worked (started through the API against the session branch): brief built, commit and push skipped |

Away from GitHub, the summarise, quiz, validate, archive and prune code was run against a scripted stand-in for the model: full brief, a rejected question that passes on retry, a rejected question that is dropped, one topic failing twice, unusable replies, no token, and a crash inside the LLM step. All behaved as described above.

One ranking fix came out of the first run: a Guardian live blog titled "... - live" reached Top headlines because only the "– live" spelling was excluded. Both are now excluded.

## Output files

`data/daily/YYYY-MM-DD.json` (kept 7 days):

| Field | Content |
| --- | --- |
| `date`, `generated_at`, `edition`, `status`, `read_minutes`, `issues` | Run facts; `status` is `full`, `partial` or `headlines_only` |
| `topics` | The five topics in display order (`id`, `label`) |
| `stories` | `id`, `topic`, `subtopic`, `title`, `url`, `source`, `published`, `headline_only`, `summary`, `why_it_matters`, `access_note` (macro), `concept` (`id`, `label`) |
| `market_idea` | `title`, `based_on` (story id), `url`, `source`, `what_the_trade_is`, `how_it_is_expressed`, `retail_access`, `what_makes_it_work`, `what_breaks_it`, `concept`, `disclaimer` |
| `quiz` | `id`, `story_id`, `topic`, `question`, `options` (4), `answer` (index 0–3), `explanation`, `evidence`, `tests` (`why` or `fact`), `concept` |
| `llm` | `provider`, `model`, `calls` |

`data/archive/YYYY-MM.json` (kept indefinitely): one entry per day with the stories as headline, link and source, and the questions with options, answer, explanation, concept tag, headline and link. No summaries.

## What session 1 built

| Pipeline step | Where | What it does |
| --- | --- | --- |
| 1. Trigger | `pipeline/run.py` | Runs every step in order |
| 2. Fetch | `pipeline/fetch.py` | Pulls every enabled source in parallel and normalises to title, URL, source, published time, text. One failing source never stops the run. Headline-only sources never carry article text forward |
| 3. Filter | `pipeline/filter.py` | Drops items older than 36 hours, items with no date, live blogs, duplicate URLs, near-identical titles, and anything in an earlier `data/daily/*.json` |
| 4. Rank and allocate | `pipeline/rank.py` | Tags each item to a topic and sub-topic by keyword, scores it on source weight, recency and keyword match, then fills the slots per topic |

Ranking details worth knowing:

- **Score** = 0.35 × source weight + 0.25 × recency + 0.40 × keyword match, all set in `config/topics.yaml`. A title match counts double a text match.
- **Insurance** takes 1 corporate and 1 specialty story, falls back to 2 specialty if corporate is thin, boosts London and UK stories, and ranks people-move stories lower.
- **Variety:** within a topic, a second story from the same sub-topic loses 0.15 and one from the same outlet loses 0.05, so picks spread across themes and sources unless one story is clearly stronger.
- **Geopolitics** always fills 1 slot; the second is filled only if a story scores 0.55 or more.
- **Top headlines** has no topic keywords. It ranks on significance: 70% how many other outlets carry the same event, 30% significance keywords (killed, strike, talks, and so on), plus the usual source weight and recency. Running order is not used. Entertainment and celebrity words in the title take 0.35 off. It skips any event already picked for another topic.
- **Central banks (macro):** BoE, ECB and Fed press releases get +0.15, and the best fresh one always takes one macro slot. This counts everything in those feeds that passes the macro keyword and exclusion rules, so an ECB speech can take the slot.
- **One event, one slot:** two stories about one event (two or more distinctive headline or URL words in common, making up 40%+ of the shorter story's words) cannot fill two slots, in one topic or across topics. If an event is picked under two topics, the lower-scoring copy is removed and that topic re-picks. Events described in different words are not caught: on 11 Nov the CoreWeave and Anthropic IPO stories under AI and macro still count as two.
- **Macro** fills 2 story slots. The third slot, the "market idea", is written by the LLM from those stories.

## Source check (11 Nov 2026)

20 of the brief's 27 candidate feeds work. Seven were dropped under the brief's rule and remain in `config/sources.yaml` as `enabled: false` with the reason. A further 17 sources were then added to replace Reuters and widen the range of outlets, giving 37 enabled sources; all returned items on 11 Nov.

| Topic | Working (from the brief) | Added | Dropped |
| --- | --- | --- | --- |
| Insurance | Insurance Journal (main and international), Artemis, Reinsurance News, Carrier Management, Insurance Business UK | Commercial Risk | Lloyd's press releases (no feed), The Insurer (401), Insurance Insider (404) |
| AI and markets | The Verge AI, TechCrunch AI, Import AI (weekly), Hacker News (keyword filtered, headline only) | Ars Technica AI, MIT Technology Review, CNBC technology | Reuters technology |
| Macro and markets | Guardian business, Bank of England, ECB, Federal Reserve, FT Alphaville (headline only) | CNBC markets, CNBC economy, City AM, Bank of England speeches, ONS release calendar, WSJ markets and The Economist finance (both headline only) | Reuters markets |
| Geopolitics | Guardian world, BBC World, Foreign Policy (headline only) | Al Jazeera, France 24, DW, Politico Europe, WSJ world and The Economist international (both headline only) | Reuters world |
| Top headlines | BBC top stories, Guardian UK | None | Reuters top news |

Reuters no longer publishes public RSS, which removed the main neutral wire source from four topics. The added sources are there to offset that: a market-side and centre-right view (CNBC, City AM, WSJ, The Economist), non-UK views on geopolitics (Al Jazeera, France 24, DW, Politico Europe) and more primary sources for macro.

**Guardian:** stays on the public RSS feeds, which carry a few paragraphs rather than full text. The Open Platform API path is written and switches on if `GUARDIAN_API_KEY` is set, but it has never been run against a real key and is not planned.

**Watchlist data** (not fetched yet; sources recorded in `config/topics.yaml`):

The watchlist is cut to the five markers with a verified free source (decision recorded in BRIEF.md). The other six were removed from the config.

| Marker | Source |
| --- | --- |
| UK 10-year gilt | Bank of England database, about 2 working days behind |
| US 10-year Treasury | US Treasury daily yield curve CSV |
| German 10-year Bund | Bundesbank API |
| EUR/USD, GBP/USD | ECB reference rates (GBP/USD derived from the two euro rates) |

Dropped: OAT–Bund and BTP–Bund (ECB country yields are monthly only), Brent and S&P 500 (FRED timed out), gold and FTSE 100 (Stooq blocks automated requests).

## How to add or change a source

Edit `config/sources.yaml`; the fields are explained at the top of the file. Set `access: headline_only` for anything paywalled. To switch a source off, set `enabled: false` and add a `reason`.

Slots, keywords, score weights, the summary lens, concept tags and the watchlist live in `config/topics.yaml`. To tune summaries or questions, edit the text files in `prompts/`.

## Secrets and settings

Set under the repo's Settings → Secrets and variables → Actions.

| Name | Kind | Needed for | Status |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | Built in | GitHub Models (the workflow grants `models: read`) and committing the brief | Nothing to set up |
| `NTFY_TOPIC` | Secret | Push notification | Required; without it the run warns and sends no push |
| `GUARDIAN_API_KEY` | Secret | Guardian full text | Optional and not planned; RSS is used without it |
| `LLM_MODEL` | Variable | Changing the model | Optional; default `openai/gpt-4.1-mini` |
| `LLM_PROVIDER` | Variable | Changing the provider | Optional; default `github_models`, the only one built |
| `LLM_MAX_CALLS` | Variable | Call cap per run | Optional; default 14 |
| `SITE_URL` | Variable | Makes the push open the app when tapped | Set in session 3 |

## Repo layout

```
.github/workflows/daily.yml   06:00 cron + manual run
config/sources.yaml           feeds, topics, weights
config/topics.yaml            slots, keywords, scoring, lens, concept tags, watchlist
pipeline/                     run, fetch, filter, rank, summarise, quiz, validate, output, notify, llm
prompts/                      summary.txt, summary_macro.txt, quiz.txt
data/daily/                   last 7 days, full
data/archive/                 quizzes and links, one file per month
data/primers/                 empty until session 4
site/                         empty until session 3
```

## Next: session 3 (app)

- Today and Quiz screens, streak, review queue drawn from the archive
- Deploy to GitHub Pages from the workflow, then set `SITE_URL`
- Confirm the ntfy push arrives on the phone

Not built yet, and not assigned to a session in the brief:

- **Watchlist data:** the five markers are in config but nothing fetches them, so the daily file has no watchlist yet. The Today screen needs it
- **Weekend lighter edition:** deferred; weekends run the normal edition
- **Claude fallback provider:** the wrapper takes a second provider, but only GitHub Models is built

Open items:

- **GitHub Models:** confirm it serves real replies, then check a dry run's summaries and questions. The default model id `openai/gpt-4.1-mini` could not be checked against the catalogue for the same reason; if it is rejected, set the `LLM_MODEL` variable
- Import AI blocks GitHub's runners (403), so it never contributes; switch it off or find another feed
- Feeds that carry one or two sentences (BBC, some Guardian items) give short summaries, because the LLM may only use feed text
- The 06:00 cron can start late: GitHub delays scheduled jobs at busy times, often by 5–30 minutes
- Events described in different words can still fill two slots (CoreWeave results under macro and the Anthropic IPO under AI on 11 Nov)
- Top headlines significance is a proxy (outlet coverage plus keywords); an entertainment story with no keyword in its title can still get through
- `feed_order: editorial` in `config/sources.yaml` is no longer used by the ranker
- Ranking and prompts have been tuned against very few days of news; review after a week of runs
