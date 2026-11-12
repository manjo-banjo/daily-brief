# Daily Brief App — Build Brief

## Purpose and constraints

Build a personal daily brief: 10–11 stories across five topics, read in about 10 minutes, followed by a 5–8 question quiz that proves the reading stuck. The product is the habit loop (read → test → streak), not the news itself.

**Success after 4 weeks**

- Opened on at least 5 of 7 days
- Average quiz score of 70% or higher
- Foundations primer completed for every topic

**Hard constraints**

| Constraint | Rule |
| --- | --- |
| Cost | £0 in total: free hosting and free LLM inference (GitHub Models), no card on file |
| Platform | GitHub repo, GitHub Actions for the daily job, GitHub Pages for the app |
| Device | iPhone-first web app, added to the home screen; works on desktop |
| Content | No scraping of paywalled sites; summaries are written by the LLM from feed text and always link to the original |
| Repo size | Rolling window for full content; only quizzes and links kept long term (see Storage) |
| Build window | Phase 1 built with Fable before Mon 17 Nov, 07:59 UK; phase 2 on Sonnet or Opus afterwards |

## Topics and foundations

Five topics, each with a one-off **Foundations primer** (8–12 short concept cards plus its own quiz) that you complete before relying on the daily feed. Every daily story is tagged to a primer concept, so you see the news and the underlying idea together.

| Topic | Daily slots | Sub-topics and lens | Foundations primer covers |
| --- | --- | --- | --- |
| Insurance | 2 (1 corporate, 1 specialty) | Corporate: commercial P&C carriers, results, M&A, ratings, pricing. Specialty: Lloyd's and London Market, reinsurance, ILS and cat bonds, MGAs. London first, then US and global | How insurers make money (combined ratio, investment income); the underwriting cycle; reinsurance and the 1/1 renewals; how Lloyd's works; MGAs and delegated authority; cat bonds and ILS; capital rules |
| AI and markets | 2 | Market development (models, chips, compute, labs' business models, regulation) and the implications for financial markets (capex cycle, valuations, power demand, market concentration) | What an LLM is; training versus inference; the chip and compute supply chain; hyperscaler capex; how AI labs make money; agents; EU AI Act; how AI moves markets |
| Macro and markets | 3 (2 stories plus a market idea), plus a watchlist panel | Whatever is moving across rates, sovereign spreads, FX, credit, commodities and equity indices, plus central banks. Each story ends with a factual "how this can be accessed" note (instrument types only). Daily "market idea": one setup in the news, explained as what the trade is, how it is expressed, how a UK retail investor could access it, what makes it work and what breaks it. Explanation, not a recommendation | Bond prices versus yields; the yield curve; central bank policy; inflation; FX drivers; commodities basics. Trade structures: carry, relative-value spreads, curve steepeners and flatteners, FX carry, hedging. Instrument families a UK retail investor can use (gilts, bond and commodity ETFs, FX, futures, options, spread bets and CFDs), with leverage, margin and tax treatment |
| Geopolitics | 1–2 | Default: themes that move markets. US–China (tariffs, chips), Russia–Ukraine and European security, Middle East and energy, major elections, French politics | Key flashpoints; the main institutions (EU, NATO, G7, UN); how sanctions work; how geopolitics reaches markets (energy, risk premia, safe havens) |
| Top headlines | 2 | The biggest UK and global stories not covered above | None |

**Daily story format:** headline · 3-sentence summary · "Why it matters" (one line, the so-what) · primer concept tag · source link.

**Watchlist panel (macro):** about 10 markers, each with level, daily change and a one-line driver when it moves sharply: UK 10-year gilt, US 10-year Treasury, German 10-year Bund, OAT–Bund and BTP–Bund spreads, GBP/USD, EUR/USD, Brent, gold, S&P 500, FTSE 100. The list lives in config, so markers can be added or dropped without code changes.

## Sources

Sources are a candidate list, not verified feeds: the first build task is to confirm a working RSS or API endpoint for each one and drop any that fail. Everything lives in `config/sources.yaml`, so adding or removing a source never needs a code change.

| Topic | Candidate sources | Access rule |
| --- | --- | --- |
| Insurance | Insurance Journal, Artemis, Reinsurance News, Carrier Management, Insurance Business UK, Lloyd's press releases, The Insurer and Insurance Insider (paywalled) | Paywalled sources: headline and link only |
| AI and markets | Reuters technology, The Verge AI, TechCrunch AI, Import AI newsletter, Hacker News top stories (filtered by keyword) | Free feeds only |
| Macro and markets | Guardian business (Open Platform API, full text), Bank of England, ECB and Fed press releases, Reuters markets, FT Alphaville (headline and link) | Central bank releases are primary sources; weight them highest |
| Geopolitics | Guardian world (API), BBC World, Reuters world, Foreign Policy (headline and link) | Free feeds only |
| Top headlines | BBC top stories, Guardian UK (API), Reuters top news | Free feeds only |

**Watchlist data:** confirm a free daily source for each watchlist marker (for example central bank statistics APIs for yields and the ECB's reference rates for FX). Any marker without a reliable free source is dropped, never estimated.

**Rules for every source:** no scraping of pages behind a login or paywall; summaries are written from feed text only; every story links to its original.

## Daily pipeline

One GitHub Actions job runs at 06:00 UK, builds the day's brief and quiz as a JSON file, and deploys the site. A failed LLM step must still publish a headlines-only brief, so the habit never breaks on a bad day.

1. **Trigger:** cron at 06:00 UTC (06:00 UK in winter, 07:00 in summer; adjust in March), plus a manual "run now" button.
2. **Fetch:** pull every source in `config/sources.yaml`; normalise to title, URL, source, published time, text.
3. **Filter:** drop items older than 36 hours, duplicates (same URL or near-identical titles) and anything already used on a previous day.
4. **Rank and allocate:** tag each item to a topic and sub-topic, score it on source weight, recency and keyword match, then fill the daily slots per topic.
5. **Summarise:** one LLM call per topic returns, for each story, the 3-sentence summary, the "Why it matters" line and the primer concept tag.
6. **Quiz:** one LLM call writes one multiple-choice question per story, plus up to 3 questions pulled from the review queue (see Quiz design).
7. **Validate:** check the JSON against a schema; reject any question whose answer is not stated in its summary; retry once, then fall back to headlines only.
8. **Write and prune:** save `data/daily/YYYY-MM-DD.json`, append the quiz to the archive, delete daily files older than 7 days.
9. **Deploy and notify:** commit, publish to GitHub Pages, send a push notification via ntfy.sh.

**LLM settings:** provider and model set by environment variables, so the cheapest adequate model can be swapped in without code changes; a hard cap on calls per run keeps it inside the free limits.

## Quiz and retention design

The quiz tests understanding, not recall of trivia: a question you can answer without reading the story is a failed question. Missed questions come back later, which is what turns daily reading into retained knowledge.

| Element | Rule |
| --- | --- |
| Daily quiz | One multiple-choice question per story (4 options), unlocked after the brief is scrolled to the end |
| Question quality | At least half test the "why it matters" (cause, implication), not a number or name; wrong options must be plausible |
| Feedback | After each answer: correct option, one-line explanation, link back to the story |
| Review queue | A missed question returns 3 days later, then 7 days later if missed again; up to 3 review questions a day |
| Primer quizzes | 8–12 questions per topic; a topic shows as "foundations complete" at 80% or higher |
| Streak | A day counts when the quiz is finished, not when the brief is opened |
| Weekly recap | Sunday screen: days completed, score by topic, the 3 most-missed concepts with links to their primer cards |

## Storage and retention

File size is not the binding constraint: at an estimated 30–60 KB a day, the repo stays far below GitHub Pages' recommended 1 GB for the source repository and 1 GB cap on the published site. The retention model below keeps it lean anyway and keeps the app fast on a phone.

| Tier | Kept | Held for | Estimated size |
| --- | --- | --- | --- |
| Daily brief (`data/daily/YYYY-MM-DD.json`) | Full summaries, why-it-matters, tags, links, quiz | 7 days, then deleted | Under 0.5 MB in total |
| Quiz archive (`data/archive/YYYY-MM.json`, one file per month) | Questions, options, answer, explanation, concept tag, headline, source link; no summaries | Indefinitely | About 3 MB a year |
| Primers (`data/primers/<topic>.json`) | Concept cards and primer quizzes | Permanent; edited by hand | Under 0.5 MB |
| Your progress | Scores, streak, review queue | On your phone (browser storage); optional export to a file | None in the repo |

**Git history:** deleted daily files stay in history, adding an estimated 20 MB a year. That is acceptable for years; if it ever matters, a yearly squash of the data folder resets it.

**Visibility:** public repo on GitHub Pages (confirmed). Briefs and quizzes are public on the web; scores are not.

## Front end

Five screens, mobile-first, one hand, no login. Clean editorial look (serif headlines, generous spacing, light and dark mode), with the brief readable in about 10 minutes.

| Screen | What it shows | Phase |
| --- | --- | --- |
| Today | Date, streak, time to read; stories grouped by topic, each with summary, why it matters, concept tag and source link; macro watchlist panel; "Take the quiz" button at the end | 1 |
| Quiz | One question at a time, instant feedback with explanation and link back, score at the end, streak updated | 1 |
| Foundations | One card deck per topic; cards are short (under 120 words), each with a primer quiz; completion badge at 80% | 1 |
| Archive | Past 7 days in full; older days as headlines, links and their quiz, retakeable | 2 |
| Progress | Streak, score by topic over time, weekly recap, most-missed concepts | 2 |

Tapping a concept tag on any story opens its Foundations card, so a term you do not know is one tap from an explanation.

## Stack and repo layout

The stack is fixed before the build starts: Python for the pipeline, plain HTML, CSS and JavaScript for the app, no framework and no build step. Fewer moving parts means less Fable budget spent on setup and fewer things to break.

| Layer | Choice |
| --- | --- |
| Pipeline | Python 3.12; `feedparser`, `httpx`, `pydantic` (schema checks), `pyyaml` |
| LLM | GitHub Models (free, via the built-in GITHUB_TOKEN with `models: read` permission, no key) behind a provider-agnostic wrapper; Claude via a Pro subscription token as the fallback |
| App | Static HTML, CSS and vanilla JavaScript; installable to the iPhone home screen |
| Progress storage | Browser storage (localStorage), with an export and import button |
| Hosting | GitHub Pages (public repo) |
| Notifications | ntfy.sh push to the ntfy iPhone app; the topic name is stored as the GitHub secret NTFY_TOPIC, never in code |

```
daily-brief/
  .github/workflows/daily.yml   # 06:00 cron + manual run
  config/sources.yaml           # feeds, topics, weights
  config/topics.yaml            # slots, keywords, watchlist
  pipeline/                     # fetch, rank, summarise, quiz, validate, prune
  prompts/                      # summary and quiz prompts as text files
  data/daily/                   # last 7 days, full
  data/archive/                 # quizzes and links, monthly files
  data/primers/                 # foundations cards and quizzes
  site/                         # index.html, app.js, styles.css
  README.md                     # setup, secrets, how to add a source
```

Prompts live in their own files so quiz and summary quality can be tuned without touching code.

## Fable session plan and acceptance criteria

Phase 1 is four focused Fable sessions, each with one goal, finishing before Mon 17 Nov, 07:59 UK. Save the Fable reset for Sunday's fix-and-polish session.

1. **Session 1 — sources and ranking:** repo scaffold, verify every source, pipeline steps 1–4 running locally, output a ranked story list.
2. **Session 2 — content and automation:** summaries, quiz, validation, JSON output, Actions workflow, first scheduled run.
3. **Session 3 — app:** Today and Quiz screens, streak, deploy to Pages, push notification.
4. **No Fable:** use the app for a day; list bugs and weak questions.
5. **Session 4 (after the reset) — primers and fixes:** generate the five Foundations decks, fix the bug list, tune prompts.

**Kickoff prompt for every session**

> Read BRIEF.md. Today's goal is session N only: [goal]. Do not change the stack or add features outside this session's scope. Ask before any decision the brief does not cover. End the session by updating README.md with what was built and what is next.

**Phase 1 is done when:**

- [ ] The 06:00 job runs unattended for 3 days in a row
- [ ] Each brief has 10–11 stories across all five topics, every one with a working source link
- [ ] Every quiz answer is stated in its story's summary (spot-check 20 questions)
- [ ] An LLM failure still publishes a headlines-only brief
- [ ] The app opens from the iPhone home screen, and the streak survives closing the app
- [ ] Daily files older than 7 days are deleted; the archive keeps quizzes and links only
- [ ] All five Foundations decks are live with their quizzes
- [ ] LLM calls stay within GitHub Models' free limits for 3 days, at £0

## Settled inputs

| Input | Setting |
| --- | --- |
| LLM provider | GitHub Models free tier; Claude subscription token as the fallback |
| Repo visibility | Public repo on GitHub Pages |
| Delivery time | 06:00 UK |
| Reading length | About 10 minutes, 10–11 stories |
| Weekends | Lighter edition: top 5 stories of the week plus the review queue |
| Insurance balance | 1 corporate and 1 specialty a day, London first, US and global rotating; 2 specialty if corporate news is thin |
| Geopolitics scope | The five market-moving themes in Topics |
| Watchlist | About 10 markers across rates, spreads, FX, commodities and equities |
| Notifications | ntfy.sh push now, WhatsApp later |

## Decisions after session 1 (11 Nov 2026)

| Decision | Setting |
| --- | --- |
| Guardian | Stays on the public RSS feeds. The Open Platform API path is written but not used, so `GUARDIAN_API_KEY` is optional and full text is not required |
| Extra sources | The 17 sources added in session 1 are accepted, bringing the enabled list to 37. They replace Reuters, which has no public RSS, and widen the range of outlets |
| Watchlist | Reduced to the markers with a verified free source: UK 10-year gilt, US 10-year Treasury, German 10-year Bund, EUR/USD and GBP/USD. OAT–Bund, BTP–Bund, Brent, gold, S&P 500 and FTSE 100 are dropped, not estimated. The brief's "about 10 markers" no longer applies. Note: that is five verified markers, not four as first stated |
| One event, one slot | A news event fills one slot across all topics, in the topic where it scores highest. Top headlines takes only what the other topics leave |
| Central banks | Fresh BoE, ECB and Fed press releases are boosted, and the best one always takes a macro slot |
| Top headlines | Ranked by significance (how many other outlets carry the story, plus significance keywords), not by the outlet's running order. Entertainment and celebrity stories are marked down |

## Decisions after session 2 (12 Nov 2026)

| Decision | Setting |
| --- | --- |
| LLM provider | GitHub Models was retired on 30 July 2026, so the free tier this brief planned around no longer exists. The LLM step uses the named fallback: Claude through a subscription token (`CLAUDE_CODE_OAUTH_TOKEN`, made with `claude setup-token`), called with the Claude Code CLI from the workflow. No extra cost beyond the existing subscription; calls count against its usage allowance |
| Partial failures | Only what failed degrades: a topic whose summaries fail twice shows headlines and links, and a question that fails validation twice is dropped. The whole brief goes headlines-only only when nothing can be summarised |
| Weekend edition | Deferred. Weekends run the normal edition until it is built |
| Review queue | Added by the app, not the pipeline: which questions were missed is known only on the phone |
