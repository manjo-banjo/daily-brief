# daily-brief

A personal daily brief: 10–11 stories across five topics, then a short quiz. The full plan is in [BRIEF.md](BRIEF.md).

**Status:** session 3 of 4 done (app). A GitHub Actions job runs at 06:00 UTC, fetches 37 sources, picks the stories, writes summaries and a quiz with Claude, commits the day's brief as JSON, publishes the app to GitHub Pages and sends a push. The app has the Today and Quiz screens, the streak and the review queue. It is not live yet: Pages has to be switched on once (see "Go live" below).

**LLM step:** Claude through a subscription token (`CLAUDE_CODE_OAUTH_TOKEN`), because GitHub Models, the brief's first choice, was retired on 30 July 2026. A dry run on 13 Nov produced a full brief: 10 summaries, the market idea and 11 quiz questions in 6 calls. The commit step and the ntfy push have not run yet; the first real run on main is their first test.

Decisions from review are recorded at the end of [BRIEF.md](BRIEF.md).

## Go live (one-off, after this is merged)

| Step | Where |
| --- | --- |
| 1. Switch Pages on | Settings → Pages → Source: **GitHub Actions** |
| 2. Publish | Actions → Deploy app → Run workflow (or wait for the 06:00 job). The run shows the site address |
| 3. Phone | Open the address in Safari → Share → Add to Home Screen |
| 4. Push | Install the ntfy app, subscribe to your topic, and check the `NTFY_TOPIC` secret matches it |

Until step 1 is done, the daily job's `publish` part fails and no push is sent; the brief is still committed.

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

Every run prints the ranking report and saves `out/ranked-YYYY-MM-DD.json`. The `out/` folder is not committed. Without the Claude Code CLI installed and `CLAUDE_CODE_OAUTH_TOKEN` set, a local run produces a headlines-only brief, which is the fallback working as designed.

**The app locally:** it reads `data/` from beside its own files, so assemble the two the way the workflow does and serve the result:

```bash
mkdir -p _site && cp -r site/. _site/ && cp -r data _site/data && python3 -m http.server -d _site 8000
```

The code runs on Python 3.9 and later; GitHub Actions uses 3.12, as the brief specifies.

## What session 3 built

| Part | Where | What it does |
| --- | --- | --- |
| Today screen | `site/app.js`, `site/styles.css` | Date, streak, story count and read time; stories grouped by topic with summary, "why it matters", access note (macro), concept tag and source link; the market idea card under macro; "Take the quiz" at the end |
| Quiz screen | `site/app.js` | One question at a time; after each answer the correct option, the explanation and a link back to the story; score overall and by topic at the end |
| Streak | `site/app.js` | A day counts when its quiz is finished. Stored on the phone, so it survives closing the app |
| Review queue | `site/app.js` | A missed question returns 3 days later, then 7 days later if missed again; up to 3 a day, added after the day's own questions and read from `data/archive/` |
| Export and import | Foot of the Today screen | Saves progress to a file and loads it back |
| Home screen | `site/index.html`, `site/manifest.webmanifest`, icons | Opens full screen from the iPhone home screen; light and dark mode follow the phone |
| Deploy | `.github/workflows/daily.yml` (`publish` job), `.github/workflows/pages.yml` | The daily job publishes `site/` plus `data/` to Pages after committing the brief, then sends the push. `pages.yml` publishes at once when anything in `site/` changes on main |

How the app behaves:

- **Which brief:** the newest daily file from the last 8 days, by UK date. Before the 06:00 run it shows the previous day's brief with a note.
- **Quiz unlock:** the button is disabled until the end of the brief has been scrolled into view.
- **Closing mid-quiz:** answers are saved one by one; reopening resumes at the next unanswered question. A finished quiz cannot be retaken (retakes belong to the Archive screen, phase 2).
- **Review queue details:** a review question answered correctly leaves the queue. One missed at the 7-day stage returns every 7 days until answered correctly (the brief does not say what happens then). A queued question no longer in the archive is dropped.
- **Headline-only stories:** shown as headline and link. A headlines-only brief has no quiz unless review questions are due.
- **Concept tags:** plain labels for now; they open Foundations cards in session 4.
- **Watchlist panel:** not shown; nothing fetches the data yet.
- **Push link:** tapping the push opens the Pages address automatically. `SITE_URL` is only needed to override it.
- **Dry runs:** build only; nothing is published or pushed.

Tested in a headless browser emulating an iPhone against the 13 Nov brief: Today renders 10 stories and the market idea, the quiz unlocks on scroll, a reload mid-quiz resumes, the score and streak update, due review questions are added and rescheduled, light and dark mode. **Not tested:** the Pages deploy and the ntfy push, which can only run on GitHub after merge, and the app on a real iPhone.

## What session 2 built

| Pipeline step | Where | What it does |
| --- | --- | --- |
| 1. Trigger | `.github/workflows/daily.yml` | Cron at 06:00 UTC plus the "Run workflow" button, with a dry-run option |
| 5. Summarise | `pipeline/summarise.py`, `prompts/summary.txt`, `prompts/summary_macro.txt` | One LLM call per topic: 3-sentence summary, "why it matters" line and primer concept tag per story. Macro also gets a "how this can be accessed" note per story and the daily market idea |
| 6. Quiz | `pipeline/quiz.py`, `prompts/quiz.txt` | One LLM call: one 4-option question per summarised story and one on the market idea |
| 7. Validate | `pipeline/validate.py`, `pipeline/models.py` | Content checks on every summary and question, one retry, then the fallback. The finished brief is checked against the `DailyBrief` schema before it is written |
| 8. Write and prune | `pipeline/output.py` | Writes the daily file, adds the quiz and links to the monthly archive, deletes daily files more than 7 days old |
| 9. Notify | `pipeline/notify.py` | ntfy.sh push after the deploy |
| LLM wrapper | `pipeline/llm.py` | Runs the Claude Code CLI (`claude -p`) with all tools off, one question and one answer per call. Provider and model from environment variables; hard cap on calls per run |

How the LLM step behaves:

- **Calls per run:** 6 when all goes well (5 topics plus the quiz), 12 at most with retries. The cap is 14 (`LLM_MAX_CALLS`).
- **Feed text only:** stories from headline-only sources (FT Alphaville, WSJ, The Economist, Foreign Policy, Hacker News) and stories with under 80 characters of feed text are never sent to the LLM. They appear as headline and link, with no quiz question.
- **Answer stated in the summary:** each question must quote, word for word, the part of the summary, "why it matters" line or access note that states its answer. A question whose quote is not found, or whose correct option uses a number that is not in that text, is rejected.
- **Retry and fallback:** a failed topic call or rejected item gets one retry with the reasons attached. After that, only what failed degrades: the story stays headline and link, or the question is dropped. If nothing can be summarised (no token, Claude unavailable, plan limit reached, any crash in the LLM step), the brief is still published as headlines only.
- **Status:** each brief is marked `full`, `partial` or `headlines_only`, and lists what degraded under `issues`.
- **Answer order:** options are shuffled in code, so the correct answer is not always in the same place.
- **Concept tags:** the list of primer concepts per topic is in `config/topics.yaml` (`concepts`), taken from the brief's Foundations column. Session 4 writes one card per id. Top headlines has none.
- **Review queue:** not added by the pipeline. Which questions were missed is known only on the phone, so the app draws review questions from the archive.

## First run (11 Nov 2026)

Nine dry runs in GitHub Actions (11 to 13 Nov) from the session branch, on Python 3.12: five from a temporary push trigger (since removed) and four manual runs. The last one, on 13 Nov, was the first with the Claude token.

| Step | Result |
| --- | --- |
| Fetch | 36 of 37 sources returned items. Import AI returns 403 to GitHub's runners every time. On the first run Insurance Journal (both feeds) and Carrier Management timed out, then worked on later runs |
| Filter and rank | 10 stories across all five topics, 2 per topic |
| Summaries and quiz | Not tested. The runs used GitHub Models: `models.github.ai` answered every request with HTTP 200 and the plain text "OK": any path, with or without a token, and the same for GitHub's own `actions/ai-inference` action. The cause: GitHub retired GitHub Models on 30 July 2026. The provider was then switched to Claude (12 Nov), which is untested until the token secret exists |
| Summaries and quiz with Claude (13 Nov) | Worked: status `full`, 10 of 10 stories summarised, market idea written, 11 questions (9 test the why), every question passed validation first time, 6 calls, about 50 seconds, read time about 7 minutes. One slip seen in a summary: "Nvidia chief executive Nvidia" where the name Jensen Huang belonged |
| Fallback | Worked on each of the eight runs before the token existed: a schema-valid headlines-only brief with the reason listed under `issues` |
| Commit, prune and ntfy push | Not tested: dry runs skip them. The first real run on main is their first test |
| Manual run with "Dry run" ticked | Worked (started through the API against the session branch): brief built, commit and push skipped |

Away from GitHub, the Claude provider was run against a stand-in CLI (good reply, refused login, rate limit, unreadable reply, CLI missing, no token), and the summarise, quiz, validate, archive and prune code was run against a scripted stand-in for the model: full brief, a rejected question that passes on retry, a rejected question that is dropped, one topic failing twice, unusable replies, no token, and a crash inside the LLM step. All behaved as described above.

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
| `CLAUDE_CODE_OAUTH_TOKEN` | Secret | Summaries and quiz, through your Claude subscription | Required; without it every brief is headlines only |
| `NTFY_TOPIC` | Secret | Push notification | Required; without it the run warns and sends no push |
| `GUARDIAN_API_KEY` | Secret | Guardian full text | Optional and not planned; RSS is used without it |
| `LLM_MODEL` | Variable | Choosing the Claude model, for example `sonnet` or `haiku` | Optional; empty uses the CLI's default for your plan |
| `LLM_PROVIDER` | Variable | Changing the provider | Optional; default `claude_code`, the only one built |
| `LLM_MAX_CALLS` | Variable | Call cap per run | Optional; default 14 |
| `SITE_URL` | Variable | Overrides the address the push opens | Optional; the Pages address is used by default |

**Creating the Claude token (once a year):** on a computer with [Claude Code](https://code.claude.com/docs/en/setup) installed, run `claude setup-token`, approve it in the browser with the account that holds your Claude subscription, and copy the token it prints. Save it as the repository secret `CLAUDE_CODE_OAUTH_TOKEN`. The token lasts one year and can only make model requests. The daily job's calls (6 to 12 short ones) count against your subscription's usage allowance. The built-in `GITHUB_TOKEN` needs no setup; it is only used to commit the brief.

## Repo layout

```
.github/workflows/daily.yml   06:00 cron + manual run: build, commit, publish, push
.github/workflows/pages.yml   publishes the app when site/ changes
config/sources.yaml           feeds, topics, weights
config/topics.yaml            slots, keywords, scoring, lens, concept tags, watchlist
pipeline/                     run, fetch, filter, rank, summarise, quiz, validate, output, notify, llm
prompts/                      summary.txt, summary_macro.txt, quiz.txt
data/daily/                   last 7 days, full
data/archive/                 quizzes and links, one file per month
data/primers/                 empty until session 4
site/                         index.html, app.js, styles.css, manifest, icons
```

## Next

1. **Go live:** the four steps at the top. The first real 06:00 run is the first test of the commit, prune, deploy and push steps
2. **No Fable day:** use the app for a day; list bugs and weak questions
3. **Session 4 (primers and fixes):** the five Foundations decks and their quizzes, concept tags that open their cards, the bug list, prompt tuning

Not built yet, and not assigned to a session in the brief:

- **Watchlist data and panel:** the five markers are in config but nothing fetches them, so the Today screen has no watchlist panel
- **Weekend lighter edition:** deferred; weekends run the normal edition

Open items:

- **No offline mode:** the app needs a connection to load the brief; there is no service worker
- **Progress is per browser:** Safari and the home-screen app can keep separate storage on iOS, so do the quiz in the home-screen app; export and import moves progress between them

- **Summary accuracy:** validation checks the quiz against the summary, not the summary against the article. Slips like the wrong name above get through; spot-check during the trial days
- **Quiz tells:** the correct option is often the longest, and several questions restate the "why it matters" line closely. Tune `prompts/quiz.txt` in session 4
- **Ranking, seen on 13 Nov:** one event (the Nvidia chief's exit) took three slots under different wording; a City AM "FTSE 100 Live:" blog took a macro slot (only "– live" and "- live" are excluded); a Fed notice on payment-service pricing took the guaranteed central-bank slot
- Each run installs the Claude Code CLI with npm (about 20 seconds); the version is not pinned
- Import AI blocks GitHub's runners (403), so it never contributes; switch it off or find another feed
- Feeds that carry one or two sentences (BBC, some Guardian items) give short summaries, because the LLM may only use feed text
- The 06:00 cron can start late: GitHub delays scheduled jobs at busy times, often by 5–30 minutes
- Events described in different words can still fill two slots (CoreWeave results under macro and the Anthropic IPO under AI on 11 Nov)
- Top headlines significance is a proxy (outlet coverage plus keywords); an entertainment story with no keyword in its title can still get through
- `feed_order: editorial` in `config/sources.yaml` is no longer used by the ranker
- Ranking and prompts have been tuned against very few days of news; review after a week of runs
