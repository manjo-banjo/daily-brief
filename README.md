# daily-brief

A personal daily brief: 10–11 stories across five topics, then a short quiz. The full plan is in [BRIEF.md](BRIEF.md).

**Status:** session 5 done (Archive and Progress screens), the first of phase 2. A GitHub Actions job runs at 05:43 UTC, fetches 37 sources, picks the stories, writes summaries and a quiz with Claude, commits the day's brief as JSON, publishes the app to GitHub Pages and sends a push. The app has all five screens (Today, Quiz, Foundations, Archive, Progress), the streak and the review queue. If Pages is not switched on yet, see "Go live" below.

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

## What session 5 built

| Part | Where | What it does |
| --- | --- | --- |
| Archive screen | `site/app.js`, `site/styles.css` | Lists past days. The last 7 days open as the full brief (from `data/daily/`); older days open as headlines, links and their quiz (from `data/archive/`) |
| Archive quizzes | `site/app.js` | Any past day's quiz can be taken or retaken, with the same instant feedback and link back to the story |
| Progress screen | `site/app.js`, `site/styles.css` | Streak, longest streak, days completed, average score; the weekly recap; score by topic over time; most-missed concepts |
| Weekly recap | Progress screen | Monday to Sunday: days completed, score by topic, the 3 most-missed concepts, each linked to its Foundations card |
| Navigation | `site/app.js` | Four tabs: Today, Foundations, Archive, Progress |

How the Archive behaves:

- **What is listed:** every day except the one on the Today screen. "Last 7 days" are the daily files that still exist; "Older" comes from the monthly archive files, this month and last to begin with. "Show earlier" loads one more month at a time and disappears at the first missing month.
- **Retake (quiz already finished):** practice only. It shows its own score and records nothing: the first score, the streak and the review queue stay as they were.
- **Late quiz (never taken):** a first attempt. Answers are saved one by one (closing mid-quiz resumes), the score feeds Progress and misses join the review queue (back in 3 days). The day is marked late and never counts towards the streak, so a streak cannot be back-filled. A late quiz has the day's own questions only, no review questions.
- **Today's day:** opening it in the Archive goes to the Today screen; its quiz is the normal daily quiz.
- **Concept tags** on a full past brief open their Foundations card, as on Today.

How Progress behaves:

- **Weekly recap:** always there, for the current Monday-to-Sunday week, with "Earlier week" and "Later week" to move about. On Sundays the Today screen also shows a link to it. Each day shows as completed, done late (L) or not done.
- **Score by topic over time:** one small bar chart for all topics and one per topic, one bar per week, up to the last 8 weeks, all on a 0–100% scale with the brief's 70% target as a dashed line. Tap a bar for that week's numbers.
- **What counts:** every recorded answer, under the day of the brief it belongs to: daily questions, review questions (under the day they were answered) and late Archive quizzes. Practice retakes never count.
- **Most-missed concepts:** ranked by number of misses, then by miss rate; top 3 in the recap, top 5 for all time. Top headlines questions have no concept, so they never appear here.
- **Export and import** buttons are on Progress as well as Today.

Also fixed: the quiz question on the market idea had no "Back to the story" link on the Today quiz; it has one now.

Tested in a headless browser emulating an iPhone, light and dark, against the real 13 and 14 Nov data plus made-up copies for earlier days and months (test copies only, not committed): the Archive list and "Show earlier", a full day and a headlines day, a late quiz with a reload half way, a practice retake leaving stored progress untouched, the Today quiz and streak after the change, the recap for this week and earlier weeks, a most-missed concept opening its card, the chart, the Sunday link, and Progress with no data. **Not tested:** on a real iPhone, and with real data older than 7 days, since the repo holds only two days so far.

## What session 4 built

| Part | Where | What it does |
| --- | --- | --- |
| Foundations decks | `data/primers/*.json` | Five decks, 31 cards, 47 quiz questions. One card per concept id in `config/topics.yaml`, each under 120 words with an "In the news" line. `index.json` lists the decks in display order |
| Foundations screen | `site/app.js`, `site/styles.css` | One deck per row with cards read, best quiz score and the "Foundations complete" badge. Inside a deck: one card at a time, then the primer quiz |
| Concept tags | `site/app.js` | The tag on a story, and on the market idea, opens its Foundations card. "Back to the brief" returns to the same place in the brief |
| Quiz tuning | `prompts/quiz.txt`, `pipeline/validate.py`, `pipeline/quiz.py` | New prompt rules for option length and for "why" questions, plus two checks in code (below) |
| Ranking fixes | `pipeline/rank.py`, `pipeline/text.py`, `pipeline/filter.py`, `config/topics.yaml` | One slot for a dominant event, live blogs and clips excluded, routine central bank notices no longer take the guaranteed slot (below) |

The five decks:

| Deck | File | Cards | Questions |
| --- | --- | --- | --- |
| Insurance | `insurance.json` | 7 | 9 |
| AI and markets | `ai_markets.json` | 8 | 10 |
| Macro: the fundamentals | `macro_markets.json` | 6 | 10 |
| Macro: trades and instruments | `macro_trades.json` | 6 | 9 |
| Geopolitics | `geopolitics.json` | 4 | 9 |

Top headlines has no concepts and no deck, as the brief says. Macro's 12 concepts are split across two decks to make five (decision recorded in BRIEF.md).

How Foundations behaves:

- **Badge:** a deck is complete when its best quiz score is 80% or higher. The quiz can be retaken at any time; a lower score later does not remove the badge.
- **Primer quiz:** instant feedback with the explanation and the card it came from; the result lists the cards behind any missed question. A quiz left half way starts again.
- **Progress:** cards read, best score and attempts are stored on the phone with the rest of the progress, and are included in export and import.
- **Editing a deck:** edit the JSON by hand. A card's `id` must match a concept id in `config/topics.yaml`; each question names its card in `concept`. A push to `data/primers/` on main republishes the app.
- **If the decks fail to load:** the brief still shows, and tags are plain labels.

Quiz tuning, for the two tells found on 13 Nov:

- **Correct option often the longest:** the prompt now has the model write the correct option first and short, then match the wrong options to it. In code, a question whose correct option is more than 20% longer than every wrong option (and by 10 characters or more) is sent back once for a rewrite.
- **Questions restating the "why it matters" line:** the prompt now bans lifting that line and asks for the mechanism or consequence in different words. In code, a correct option that copies five or more words in a row from the text is sent back once.
- Both checks are style checks: if the rewrite is no better, the first version is kept, so they never cost a question. Run against the 13 Nov quiz, they flag 8 of its 10 questions.
- **Not tested with Claude:** the new prompt has not been run against the model, because the CLI on this Mac is not logged in. The first run on GitHub is its first test; a dry run from this branch will show the result.

Ranking fixes:

- **One event, several slots:** a name that appears in the headlines of 12 or more outlets on the day (`big_story_min_outlets`) marks a dominant event. Every story with that name in its headline counts as the same event, so it fills one slot in the whole brief, in the topic where it scores highest. On 13 Nov the markers were Nvidia, Huang and Microsoft: the Nvidia story went from three slots to one and the Microsoft outage from two to one. This also removes loosely related stories (Nvidia's chip-tracking plan) on such a day.
- **Live blogs:** titles with "Live:" or "live:" after any words, titles ending in "live", and "Watch:", "Listen:", "Video:" and "Podcast:" clips are dropped (`exclude_title_patterns`, regular expressions).
- **Central bank slot:** only a policy release takes the boost and the guaranteed macro slot: one with a policy word in its title, such as "monetary policy", "Bank Rate", "FOMC statement", "minutes" or "Financial Stability Report" (`priority_title_keywords`). Other notices from the BoE, ECB and Fed feeds lose 0.10 and compete like any story. On a day with no policy release, both macro slots go to the best macro stories.

Tested: the ranker against live feeds on 13 Nov (37 of 37 sources); the giveaway checks against the 13 Nov quiz and a scripted stand-in for the model; the Foundations screen in a browser at iPhone size, light and dark (tag opens its card, return to the same place in the brief, card by card through a deck, quiz at 78%, 89% and 33%, badge kept, progress saved). **Not tested:** the app on a real iPhone, and the new quiz prompt with Claude.

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
- **Closing mid-quiz:** answers are saved one by one; reopening resumes at the next unanswered question. A finished quiz is retaken from the Archive screen, as practice (session 5).
- **Review queue details:** a review question answered correctly leaves the queue. One missed at the 7-day stage returns every 7 days until answered correctly (the brief does not say what happens then). A queued question no longer in the archive is dropped.
- **Headline-only stories:** shown as headline and link. A headlines-only brief has no quiz unless review questions are due.
- **Concept tags:** open their Foundations card (session 4).
- **Watchlist panel:** not shown; nothing fetches the data yet.
- **Push link:** none. The push is a reminder; open the brief from the home-screen icon. iOS opens any link from ntfy in Safari, never in the home-screen app, and Safari keeps its own separate progress.
- **Dry runs:** build only; nothing is published or pushed.

Tested in a headless browser emulating an iPhone against the 13 Nov brief: Today renders 10 stories and the market idea, the quiz unlocks on scroll, a reload mid-quiz resumes, the score and streak update, due review questions are added and rescheduled, light and dark mode. **Not tested:** the Pages deploy and the ntfy push, which can only run on GitHub after merge, and the app on a real iPhone.

## What session 2 built

| Pipeline step | Where | What it does |
| --- | --- | --- |
| 1. Trigger | `.github/workflows/daily.yml` | Cron at 05:43 UTC plus the "Run workflow" button, with a dry-run option |
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
- **Concept tags:** the list of primer concepts per topic is in `config/topics.yaml` (`concepts`), taken from the brief's Foundations column. Each id has one card in `data/primers/`. Top headlines has none.
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
| 3. Filter | `pipeline/filter.py` | Drops items older than 36 hours, items with no date, live blogs and clips, duplicate URLs, near-identical titles, and anything in an earlier `data/daily/*.json` |
| 4. Rank and allocate | `pipeline/rank.py` | Tags each item to a topic and sub-topic by keyword, scores it on source weight, recency and keyword match, then fills the slots per topic |

Ranking details worth knowing:

- **Score** = 0.35 × source weight + 0.25 × recency + 0.40 × keyword match, all set in `config/topics.yaml`. A title match counts double a text match.
- **Insurance** takes 1 corporate and 1 specialty story, falls back to 2 specialty if corporate is thin, boosts London and UK stories, and ranks people-move stories lower.
- **Variety:** within a topic, a second story from the same sub-topic loses 0.15 and one from the same outlet loses 0.05, so picks spread across themes and sources unless one story is clearly stronger.
- **Geopolitics** always fills 1 slot; the second is filled only if a story scores 0.55 or more.
- **Top headlines** has no topic keywords. It ranks on significance: 70% how many other outlets carry the same event, 30% significance keywords (killed, strike, talks, and so on), plus the usual source weight and recency. Running order is not used. Entertainment and celebrity words in the title take 0.35 off. It skips any event already picked for another topic.
- **Central banks (macro):** BoE, ECB and Fed policy releases get +0.15, and the best fresh one always takes one macro slot. Since session 4 this needs a policy word in the title; routine notices lose 0.10.
- **One event, one slot:** two stories about one event (two or more distinctive headline or URL words in common, making up 40%+ of the shorter story's words) cannot fill two slots, in one topic or across topics. If an event is picked under two topics, the lower-scoring copy is removed and that topic re-picks. Since session 4, a name in 12 or more outlets' headlines also marks one event. Smaller events described in different words are still not caught: on 11 Nov the CoreWeave and Anthropic IPO stories under AI and macro still count as two.
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
| `SITE_URL` | Variable | Adds a link to the push | Leave unset: on iPhone the link opens Safari, not the home-screen app |

**Creating the Claude token (once a year):** on a computer with [Claude Code](https://code.claude.com/docs/en/setup) installed, run `claude setup-token`, approve it in the browser with the account that holds your Claude subscription, and copy the token it prints. Save it as the repository secret `CLAUDE_CODE_OAUTH_TOKEN`. The token lasts one year and can only make model requests. The daily job's calls (6 to 12 short ones) count against your subscription's usage allowance. The built-in `GITHUB_TOKEN` needs no setup; it is only used to commit the brief.

## Repo layout

```
.github/workflows/daily.yml   06:00 cron + manual run: build, commit, publish, push
.github/workflows/pages.yml   publishes the app when site/ or data/primers/ changes
config/sources.yaml           feeds, topics, weights
config/topics.yaml            slots, keywords, scoring, lens, concept tags, watchlist
pipeline/                     run, fetch, filter, rank, summarise, quiz, validate, output, notify, llm
prompts/                      summary.txt, summary_macro.txt, quiz.txt
data/daily/                   last 7 days, full
data/archive/                 quizzes and links, one file per month
data/primers/                 five Foundations decks and index.json; edited by hand
site/                         index.html, app.js, styles.css, manifest, icons
```

## Next

Phase 1's four sessions and the first phase 2 session (Archive and Progress) are done. What is left:

1. **Dry run from this branch:** Actions → Daily brief → Run workflow → pick the branch, tick "Dry run". This is the first test of the new quiz prompt; check the questions in the run's `out` artifact
2. **Your bug list and weak questions:** session 4's prompt had placeholders for both, so nothing from your day of use has been fixed yet. Send them and they can go into a follow-up
3. **Read the decks:** the cards and questions were written in one pass and not reviewed by you. Correct anything in `data/primers/` by hand
4. **Phase 1 checklist in BRIEF.md:** three unattended 06:00 runs in a row, and a spot-check of 20 quiz answers against their summaries
5. **Try the new screens on the phone:** Archive and Progress have only run in a test browser. Real data older than 7 days first appears on 21 Nov
6. **Rest of phase 2:** the items below

Not built yet, and not assigned to a session in the brief:

- **Watchlist data and panel:** the five markers are in config but nothing fetches them, so the Today screen has no watchlist panel
- **Weekend lighter edition:** deferred; weekends run the normal edition
- **Push that opens the home-screen app:** planned for phase 2, not yet built. It means sending the push from the app itself (web push) in place of ntfy: a service worker, a one-off "allow notifications" tap and two new secrets

Open items:

- **Archive depends on the daily job:** a day appears under "Older" only if the job wrote it to the monthly archive. "Show earlier" stops at the first month with no file, so months before a gap of a whole month cannot be reached
- **Scores by week use the brief's date:** a quiz taken late changes the score of the week it belongs to, not the week it was taken in

- **No offline mode:** the app needs a connection to load the brief; there is no service worker
- **Progress is per browser:** Safari and the home-screen app can keep separate storage on iOS, so do the quiz in the home-screen app; export and import moves progress between them

- **Summary accuracy:** validation checks the quiz against the summary, not the summary against the article. Slips like the wrong name above get through; spot-check during the trial days
- **Quiz tells:** prompt and checks changed in session 4, but untested with Claude; review the first few quizzes
- **Primer accuracy:** the cards state rules that change. Checked by web search on 13 Nov 2026, against law-firm and broker summaries, not the official texts: UK tax on spread bets and CFDs, FCA leverage limits, Solvency UK, NATO membership (all unchanged) and the EU AI Act, where the card now says the high-risk rules were pushed back to December 2027. The rest of the cards are from general knowledge
- **Big-story rule:** the 12-outlet threshold was set on one day's news. A name that is in the news every day (Trump, China) reached 8 or 9 outlets on 13 Nov; if one reaches 12 on an ordinary day, unrelated stories about it will share one slot. Raise `big_story_min_outlets` if that happens
- **Opinion pieces:** a City AM comment piece ("Britain is growing in spite of Labour") took a macro slot on 13 Nov. Nothing marks comment apart from news in the feeds
- **Macro on a quiet day:** with no policy release, the second macro slot can go to a headline-only source (WSJ), which gets no summary or question
- Each run installs the Claude Code CLI with npm (about 20 seconds); the version is not pinned
- Import AI blocks GitHub's runners (403), so it never contributes; switch it off or find another feed
- Feeds that carry one or two sentences (BBC, some Guardian items) give short summaries, because the LLM may only use feed text
- **Schedule:** the first scheduled run, 06:00 UTC on 14 Nov, never started (GitHub delays or drops scheduled jobs on the hour at busy times); that day's brief was started by hand. The cron is now 05:43 UTC. If runs are still missed, the fix is an outside trigger, which the brief does not cover
- Smaller events described in different words can still fill two slots (CoreWeave results under macro and the Anthropic IPO under AI on 11 Nov)
- Top headlines significance is a proxy (outlet coverage plus keywords); an entertainment story with no keyword in its title can still get through
- `feed_order: editorial` in `config/sources.yaml` is no longer used by the ranker
- Ranking and prompts have been tuned against very few days of news; review after a week of runs
