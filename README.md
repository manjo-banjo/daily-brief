# daily-brief

A personal daily brief: 10–11 stories across five topics, then a short quiz. The full plan is in [BRIEF.md](BRIEF.md).

**Status:** session 1 of 4 done (sources and ranking). The pipeline fetches 37 sources, then filters and ranks stories locally. There are no summaries, quiz, scheduled job or app yet.

## Run it

One-time setup:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Run the pipeline:

```bash
.venv/bin/python -m pipeline.run
```

It prints a report (source health, filter counts, the ranked list with the next-best stories per topic) and saves `out/ranked-YYYY-MM-DD.json`. The `out/` folder is not committed.

The code runs on Python 3.9 and later. This Mac has 3.9; GitHub Actions will use 3.12, as the brief specifies.

## What session 1 built

| Pipeline step | Where | What it does |
| --- | --- | --- |
| 1. Trigger | `pipeline/run.py` | Local manual run only. The 06:00 cron and "run now" button are session 2 |
| 2. Fetch | `pipeline/fetch.py` | Pulls every enabled source in parallel and normalises to title, URL, source, published time, text. One failing source never stops the run. Headline-only sources never carry article text forward |
| 3. Filter | `pipeline/filter.py` | Drops items older than 36 hours, items with no date, live blogs, duplicate URLs, near-identical titles, and anything in an earlier `data/daily/*.json` |
| 4. Rank and allocate | `pipeline/rank.py` | Tags each item to a topic and sub-topic by keyword, scores it on source weight, recency and keyword match, then fills the slots per topic |

Ranking details worth knowing:

- **Score** = 0.35 × source weight + 0.25 × recency + 0.40 × keyword match, all set in `config/topics.yaml`. A title match counts double a text match.
- **Insurance** takes 1 corporate and 1 specialty story, falls back to 2 specialty if corporate is thin, boosts London and UK stories, and ranks people-move stories lower.
- **Variety:** within a topic, a second story from the same sub-topic loses 0.15 and one from the same outlet loses 0.05, so picks spread across themes and sources unless one story is clearly stronger.
- **Geopolitics** always fills 1 slot; the second is filled only if a story scores 0.55 or more.
- **Top headlines** has no keywords. It uses the BBC's own running order as the importance signal and skips anything already picked for another topic.
- **Macro** currently fills 2 story slots. The third slot, the "market idea", is written by the LLM in session 2.

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

**Guardian:** the Open Platform API needs a free key. Until `GUARDIAN_API_KEY` is set, the three Guardian sources use the Guardian's public RSS feeds, which carry a few paragraphs rather than full text. The API path is written but has not been run against a real key.

**Watchlist data** (panel is built in a later session; sources recorded in `config/topics.yaml`):

| Marker | Status | Source |
| --- | --- | --- |
| UK 10-year gilt | Verified | Bank of England database, about 2 working days behind |
| US 10-year Treasury | Verified | US Treasury daily yield curve CSV |
| German 10-year Bund | Verified | Bundesbank API |
| EUR/USD, GBP/USD | Verified | ECB reference rates (GBP/USD derived from the two euro rates) |
| OAT–Bund, BTP–Bund | No source yet | ECB country yields are monthly only |
| Brent, S&P 500 | Not verified | FRED timed out from this machine; retry from GitHub Actions |
| Gold, FTSE 100 | No source yet | Stooq blocks automated requests |

## How to add or change a source

Edit `config/sources.yaml`; the fields are explained at the top of the file. Set `access: headline_only` for anything paywalled. To switch a source off, set `enabled: false` and add a `reason`.

Slots, keywords, score weights and the watchlist live in `config/topics.yaml`.

## Secrets and environment variables

| Name | Needed for | Status |
| --- | --- | --- |
| `GUARDIAN_API_KEY` | Guardian full text (free key from open-platform.theguardian.com) | Optional; RSS fallback without it |
| `NTFY_TOPIC` | Push notification | Session 3 |

## Repo layout

```
config/sources.yaml     feeds, topics, weights
config/topics.yaml      slots, keywords, scoring, watchlist
pipeline/               run, fetch, filter, rank (plus models, config, text helpers)
prompts/                empty until session 2
data/daily|archive|primers/   empty until sessions 2 and 4
site/                   empty until session 3
.github/workflows/      empty until session 2
```

## Next: session 2 (content and automation)

- Summaries and quiz via GitHub Models, with prompts in `prompts/`
- Validation against a schema, with the headlines-only fallback
- Write `data/daily/YYYY-MM-DD.json`, append to the archive, prune after 7 days
- `.github/workflows/daily.yml`: 06:00 cron plus manual run, on Python 3.12
- The macro "market idea" slot and the weekend lighter edition

Open items carried over from session 1:

- One event can still appear under two topics from different angles (CoreWeave results under both AI and macro on 11 Nov)
- Top headlines still relies on the BBC's running order alone
- Register a Guardian API key and test the API path
- Find free daily sources for the six unverified watchlist markers, or drop them
- Ranking has been tuned against one day of news only; review the keyword lists after a few runs
