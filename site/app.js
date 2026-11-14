"use strict";
/* Daily Brief: Today, Quiz, Foundations, Archive and Progress screens. No framework, no build step.
   Progress (answers, streak, review queue, primer scores) lives in localStorage on this device only. */

const KEY = "dailybrief.v1";
const BRIEF_BACK_DAYS = 8;      // how far back to look for the newest brief
const REVIEW_PER_DAY = 3;       // brief: up to 3 review questions a day
const REVIEW_STAGES = [3, 7];   // brief: back after 3 days, then 7 days if missed again
const PRIMER_PASS = 0.8;        // brief: a deck is "foundations complete" at 80% or higher
const FULL_DAYS = 7;            // brief: the past 7 days are kept in full; older days are headlines, links and quiz
const TARGET = 0.7;             // brief: success is an average quiz score of 70% or higher
const WEEKS_SHOWN = 8;          // Progress: weeks in the score-by-topic chart
const MOST_MISSED = 3;          // brief: the 3 most-missed concepts in the weekly recap
// Used for labels when no brief has loaded; a loaded brief's own topic list wins.
const DEFAULT_TOPICS = [
  { id: "insurance", label: "Insurance" }, { id: "ai_markets", label: "AI and markets" },
  { id: "macro_markets", label: "Macro and markets" }, { id: "geopolitics", label: "Geopolitics" },
  { id: "top_headlines", label: "Top headlines" }];
const app = document.getElementById("app");

/* ---------- small helpers ---------- */

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
function link(url, text) { return el("a", { href: safeUrl(url), target: "_blank", rel: "noopener noreferrer" }, text); }
function sentence(t) { return /[.!?]$/.test(t) ? t : t + "."; }   // no double full stop after an option
function render(...nodes) { app.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false)); window.scrollTo(0, 0); }

/* Dates are plain YYYY-MM-DD strings; "today" is the UK calendar day. */
function ukToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()); }
function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function shortDate(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); }
function weekday(iso) { return new Date(iso + "T12:00:00Z").getUTCDay(); }   // 0 = Sunday
function mondayOf(iso) { return addDays(iso, -((weekday(iso) + 6) % 7)); }   // weeks run Monday to Sunday
function addMonths(month, n) { const d = new Date(month + "-15T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); }
function longDate(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }); }

/* ---------- progress store ---------- */

function emptyState() { return { v: 1, days: {}, queue: {}, primers: {} }; }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1 && s.days && s.queue) { s.primers = s.primers || {}; return s; }   // primers: added in session 4
  } catch (e) { /* storage blocked or corrupt: start empty */ }
  return emptyState();
}
let state = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode: progress lasts until the tab closes */ } }

/* A day counts when its quiz is finished. The streak is the run of finished days ending on the
   newest finished day, and only counts while that day is today or yesterday.
   A quiz taken late from the Archive (`late`) is scored but never counts as a day. */
function countedDays() { return Object.keys(state.days).filter((d) => state.days[d].done && !state.days[d].late).sort(); }
function longestStreak() {
  let best = 0, run = 0, prev = null;
  for (const d of countedDays()) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; if (run > best) best = run; prev = d; }
  return best;
}
function streak() {
  const done = countedDays();
  if (!done.length) return 0;
  let last = done[done.length - 1];
  if (last < addDays(ukToday(), -1)) return 0;
  const set = new Set(done);
  let n = 0;
  while (set.has(last)) { n++; last = addDays(last, -1); }
  return n;
}

/* ---------- data ---------- */

async function getJson(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}
async function loadBrief() {
  const today = ukToday();
  for (let i = 0; i < BRIEF_BACK_DAYS; i++) {
    try { return await getJson(`data/daily/${addDays(today, -i)}.json`); } catch (e) { /* try the day before */ }
  }
  throw new Error("No brief found");
}
/* Foundations decks: data/primers/index.json lists them; each deck holds its cards and quiz.
   `where` maps a concept id to its deck and card, so a story's tag can open the right card. */
let primers = null;   // { decks: [...], where: { conceptId: deck } }
async function loadPrimers() {
  const index = await getJson("data/primers/index.json");
  const decks = await Promise.all(index.decks.map((id) => getJson(`data/primers/${id}.json`)));
  const where = {};
  for (const d of decks) for (const c of d.cards) where[c.id] = d;
  primers = { decks, where };
}
function cardHref(conceptId) {
  const d = primers && primers.where[conceptId];
  return d ? `#/foundations/${d.id}/${conceptId}` : null;
}
/* A concept tag: a link to its Foundations card when there is one, a plain label otherwise. */
function conceptTag(concept) {
  const href = cardHref(concept.id);
  if (!href) return el("span", { class: "tag" }, concept.label);
  return el("a", { class: "tag", href, onclick: () => { if (!location.hash.startsWith("#/archive")) todayScroll = window.scrollY; } }, concept.label);
}
let todayScroll = 0;   // where the reader was in the brief when they opened a card
const archiveCache = {};
async function archiveMonth(month) {
  if (!(month in archiveCache)) archiveCache[month] = getJson(`data/archive/${month}.json`).catch(() => null);
  return archiveCache[month];
}
const dailyCache = {};
function dailyFile(date) {
  if (!(date in dailyCache)) dailyCache[date] = getJson(`data/daily/${date}.json`).catch(() => null);
  return dailyCache[date];
}
async function archivedQuestion(qid) {
  const month = qid.slice(0, 7);
  const a = await archiveMonth(month);
  if (!a) return null;
  for (const day of a.days) for (const q of day.questions) if (q.id === qid) return q;
  return null;
}

/* ---------- quiz session ---------- */

let brief = null;
let loadedOn = null;   // UK day the brief was last fetched
let session = null;   // { date, questions: [...], index, review: {qid: true} }

async function buildSession() {
  const date = brief.date;
  const day = (state.days[date] = state.days[date] || { done: false, answers: {}, reviewIds: null });
  if (!day.reviewIds) {
    const today = ukToday();
    const due = Object.entries(state.queue)
      .filter(([qid, e]) => e.due <= today && !brief.quiz.some((q) => q.id === qid))
      .sort((a, b) => a[1].due.localeCompare(b[1].due))
      .slice(0, REVIEW_PER_DAY)
      .map(([qid]) => qid);
    day.reviewIds = due;
    save();
  }
  const review = [];
  for (const qid of day.reviewIds.slice()) {
    const q = await archivedQuestion(qid);
    if (q) review.push(Object.assign({ isReview: true }, q));
    else if (await archiveMonth(qid.slice(0, 7))) {
      // the archive loaded but no longer holds this question: drop it so it cannot block the queue
      delete state.queue[qid];
      day.reviewIds = day.reviewIds.filter((id) => id !== qid);
      save();
    }
  }
  const questions = questionsOf(brief).concat(review);
  return { date, questions };
}
/* A brief's own questions, each with the headline and link of the story (or market idea) it came from. */
function questionsOf(b) {
  const origin = (id) => b.stories.find((s) => s.id === id) || (b.market_idea && b.market_idea.id === id ? b.market_idea : {});
  return b.quiz.map((q) => Object.assign({ isReview: false, headline: origin(q.story_id).title, url: origin(q.story_id).url }, q));
}

function record(date, q, pick) {
  const day = (state.days[date] = state.days[date] || { done: false, answers: {}, reviewIds: null });
  const ok = pick === q.answer;
  day.answers[q.id] = { pick, ok, topic: q.topic, concept: q.concept ? q.concept.id : null, review: q.isReview };
  if (q.isReview) {
    // right: leaves the queue. Missed again: back in 7 days, and every 7 days until answered right.
    if (ok) delete state.queue[q.id];
    else state.queue[q.id] = { stage: 2, due: addDays(ukToday(), REVIEW_STAGES[1]) };
  } else if (!ok) {
    state.queue[q.id] = { stage: 1, due: addDays(ukToday(), REVIEW_STAGES[0]) };
  }
  save();
}

/* ---------- screens ---------- */

function nav(current) {
  const item = (id, href, text) => el("a", { href, class: current === id ? "on" : null, "aria-current": current === id ? "page" : null }, text);
  return el("nav", { class: "nav" }, item("today", "#/", "Today"), item("foundations", "#/foundations", "Foundations"),
    item("archive", "#/archive", "Archive"), item("progress", "#/progress", "Progress"));
}

function topBar() {
  const n = streak();
  return [el("header", { class: "top" },
    el("div", {}, el("h1", {}, "Daily Brief"), el("div", { class: "muted small" }, longDate(brief.date))),
    el("div", { class: "streak" }, el("b", {}, String(n)), el("span", { class: "muted small" }, "day streak"))),
    nav("today")];
}

function storyNode(s) {
  const node = el("article", { class: "story" }, el("h3", {}, s.title));
  if (s.headline_only || !s.summary) {
    node.append(el("p", { class: "muted small" }, "Headline only. ", link(s.url, `Read at ${s.source}`)));
    return node;
  }
  node.append(el("p", {}, s.summary));
  if (s.why_it_matters) node.append(el("p", { class: "why" }, el("b", {}, "Why it matters: "), s.why_it_matters));
  if (s.access_note) node.append(el("p", { class: "access" }, el("b", {}, "How this can be accessed: "), s.access_note));
  const meta = el("div", { class: "meta" });
  if (s.concept) meta.append(conceptTag(s.concept));
  meta.append(link(s.url, `Source: ${s.source}`));
  node.append(meta);
  return node;
}

function marketIdea(m) {
  const row = (label, text) => (text ? [el("dt", {}, label), el("dd", {}, text)] : []);
  return el("section", { class: "card" },
    el("div", { class: "muted small" }, "Market idea"),
    el("h3", {}, m.title),
    el("dl", {},
      row("What the trade is", m.what_the_trade_is), row("How it is expressed", m.how_it_is_expressed),
      row("How a UK retail investor could access it", m.retail_access), row("What makes it work", m.what_makes_it_work),
      row("What breaks it", m.what_breaks_it)),
    el("p", { class: "muted small" }, m.disclaimer || "Explanation, not a recommendation."),
    el("div", { class: "meta" }, m.concept ? conceptTag(m.concept) : null, link(m.url, `Based on: ${m.source}`)));
}

async function showToday() {
  const parts = [...topBar()];
  parts.push(el("div", { class: "muted small" }, `${brief.stories.length} stories · about ${brief.read_minutes} min`));
  if (brief.status !== "full") {
    parts.push(el("div", { class: "notice" }, brief.status === "headlines_only"
      ? "Today's summaries could not be written, so this is headlines and links only."
      : "Some stories are headlines only today."));
  }
  if (brief.date < ukToday()) parts.push(el("div", { class: "notice" }, `Today's brief is not out yet. This is ${longDate(brief.date)}.`));
  if (weekday(ukToday()) === 0) parts.push(el("div", { class: "notice" }, "It is Sunday. ", el("a", { href: "#/progress" }, "See your weekly recap")));

  for (const t of brief.topics) {
    const stories = brief.stories.filter((s) => s.topic === t.id);
    const idea = t.id === "macro_markets" && brief.market_idea;
    if (!stories.length && !idea) continue;
    parts.push(el("h2", {}, t.label), ...stories.map(storyNode));
    if (idea) parts.push(marketIdea(brief.market_idea));
  }

  const sentinel = el("div", { class: "sentinel" });
  const day = state.days[brief.date];
  const reviewCount = (await buildSession()).questions.length - brief.quiz.length;
  const hasQuiz = brief.quiz.length + reviewCount > 0;
  const finished = !!(day && day.done);
  const btn = el("button", { disabled: hasQuiz && !finished, onclick: () => { location.hash = "#/quiz"; } },
    finished ? "Quiz done: see your score" : "Take the quiz");
  const end = el("section", { class: "end" });
  if (hasQuiz) {
    const total = brief.quiz.length + reviewCount;
    end.append(btn, el("p", { class: "muted small center" },
      finished ? "" : `${total} questions${reviewCount ? `, ${reviewCount} from your review queue` : ""}. Unlocks when you reach the end.`));
  } else {
    end.append(el("p", { class: "muted center" }, "No quiz today."));
  }
  parts.push(sentinel, end, footer());
  render(...parts);
  if (todayScroll) { window.scrollTo(0, todayScroll); todayScroll = 0; }   // back from a Foundations card

  if (hasQuiz && !finished) {
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries, obs) => {
        if (entries.some((e) => e.isIntersecting)) { btn.disabled = false; obs.disconnect(); }
      }).observe(sentinel);
    } else btn.disabled = false;
  }
}
async function showQuiz() {
  const day = state.days[brief.date];
  if (day && day.done) return showResult();
  session = await buildSession();
  if (!session.questions.length) { location.hash = "#/"; return; }
  // resume where the person left off if the app was closed mid-quiz
  session.index = session.questions.findIndex((q) => !(q.id in state.days[brief.date].answers));
  if (session.index < 0) session.index = session.questions.length;
  showQuestion();
}

/* One question with instant feedback. Shared by the daily quiz and the Archive quizzes.
   o: { head, q, index, total, picked() -> option index or null, onPick(i), onNext(), missNote, foot } */
function questionScreen(o) {
  const { q, index, total } = o;
  const feedback = el("div");
  const opts = el("div", { class: "options" });
  const next = el("button", { onclick: o.onNext }, index + 1 === total ? "Finish" : "Next");
  next.hidden = true;
  function reveal(pick) {
    const ok = pick === q.answer;
    [...opts.children].forEach((b, i) => {
      b.disabled = true; b.style.opacity = 1;
      if (i === q.answer) b.classList.add("right");
      else if (i === pick) b.classList.add("wrong");
    });
    feedback.replaceChildren(el("div", { class: "feedback" },
      el("div", { class: ok ? "ok" : "no" }, ok ? "Correct" : "Not quite"),
      el("p", {}, `${sentence(q.options[q.answer])} ${q.explanation}`),
      q.url ? el("p", { class: "small" }, link(q.url, `Back to the story: ${q.headline || ""}`)) : null,
      !ok && o.missNote ? el("p", { class: "muted small" }, o.missNote) : null));
    next.hidden = false;
  }
  q.options.forEach((text, i) => opts.append(el("button", { class: "opt", onclick: () => {
    if (o.picked() != null) return;
    o.onPick(i);
    reveal(i);
  } }, text)));
  render(
    o.head || null,
    el("div", { class: "muted small" }, `Question ${index + 1} of ${total}`, q.isReview ? " · review" : ""),
    el("div", { class: "progress" }, el("i", { style: `width:${(index / total) * 100}%` })),
    el("h3", {}, q.question), opts, feedback, next, o.foot || null);
  if (o.picked() != null) reveal(o.picked());
}

function showQuestion() {
  const { questions, index } = session;
  if (index >= questions.length) return finishQuiz();
  const q = questions[index];
  const answers = state.days[brief.date].answers;
  questionScreen({
    q, index, total: questions.length,
    picked: () => (q.id in answers ? answers[q.id].pick : null),
    onPick: (i) => record(brief.date, q, i),
    onNext: () => { session.index++; showQuestion(); },
    missNote: "This one comes back for review.",
    foot: el("p", { class: "center small" }, el("a", { href: "#/" }, "Back to the brief")) });
}

function finishQuiz() {
  const day = state.days[brief.date];
  day.done = true;
  day.completedAt = new Date().toISOString();
  save();
  showResult();
}

function showResult() {
  const day = state.days[brief.date];
  const list = Object.values(day.answers);
  const right = list.filter((a) => a.ok).length;
  const byTopic = {};
  for (const a of list) { const t = (byTopic[a.topic] = byTopic[a.topic] || [0, 0]); t[1]++; if (a.ok) t[0]++; }
  const label = (id) => (brief.topics.find((t) => t.id === id) || { label: id }).label;
  const n = streak();
  render(
    el("h1", {}, "Done"),
    el("div", { class: "big" }, `${right} / ${list.length}`),
    el("p", { class: "muted" }, `${n} day streak${n > 1 ? ". Keep it going tomorrow." : "."}`),
    el("ul", {}, Object.entries(byTopic).map(([id, [r, t]]) => el("li", {}, `${label(id)}: ${r} / ${t}`))),
    el("div", { class: "row" }, el("a", { class: "btn", href: "#/" }, "Back to the brief")));
}

/* ---------- Foundations ---------- */

function primerState(deckId) {
  return (state.primers[deckId] = state.primers[deckId] || { best: 0, attempts: 0, seen: {} });
}
function passed(deckId) { const p = state.primers[deckId]; return !!(p && p.best >= PRIMER_PASS); }
function passMark(total) { return Math.ceil(total * PRIMER_PASS - 1e-9); }
function badge() { return el("span", { class: "badge" }, "✓ Foundations complete"); }
function percent(x) { return Math.round(x * 100) + "%"; }

function showFoundations() {
  const done = primers.decks.filter((d) => passed(d.id)).length;
  render(
    el("header", { class: "top" }, el("div", {}, el("h1", {}, "Foundations"),
      el("div", { class: "muted small" }, `${done} of ${primers.decks.length} decks complete`))),
    nav("foundations"),
    el("p", { class: "muted" }, `The ideas behind the daily stories. Read a deck, then pass its quiz at ${percent(PRIMER_PASS)} or higher to complete it.`),
    ...primers.decks.map((d) => {
      const p = state.primers[d.id];
      const seen = p ? d.cards.filter((c) => p.seen[c.id]).length : 0;
      return el("a", { class: "card deck", href: `#/foundations/${d.id}` },
        el("h3", {}, d.label),
        el("p", {}, d.intro),
        el("div", { class: "meta" },
          passed(d.id) ? badge() : null,
          el("span", { class: "muted" }, `${seen} of ${d.cards.length} cards read`),
          p && p.attempts ? el("span", { class: "muted" }, `Best quiz score ${percent(p.best)}`) : el("span", { class: "muted" }, `${d.quiz.length} quiz questions`)));
    }));
}

function showDeck(deck, cardId) {
  let index = deck.cards.findIndex((c) => c.id === cardId);
  if (index < 0) index = 0;
  const card = deck.cards[index];
  const p = primerState(deck.id);
  if (!p.seen[card.id]) { p.seen[card.id] = true; save(); }
  const at = (i) => `#/foundations/${deck.id}/${deck.cards[i].id}`;
  const last = index === deck.cards.length - 1;
  render(
    el("p", { class: "small crumbs" }, el("a", { href: "#/foundations" }, "Foundations"), " › ", deck.label, passed(deck.id) ? [" ", badge()] : null),
    el("div", { class: "muted small" }, `Card ${index + 1} of ${deck.cards.length}`),
    el("div", { class: "progress" }, el("i", { style: `width:${((index + 1) / deck.cards.length) * 100}%` })),
    el("article", { class: "card primer" },
      el("h3", {}, card.title),
      el("p", {}, card.body),
      card.in_the_news ? el("p", { class: "why" }, el("b", {}, "In the news: "), card.in_the_news) : null),
    el("div", { class: "row two" },
      index > 0 ? el("a", { class: "btn ghost", href: at(index - 1) }, "Previous") : el("span"),
      last ? el("a", { class: "btn", href: `#/foundations/${deck.id}/quiz` }, "Take the quiz")
           : el("a", { class: "btn", href: at(index + 1) }, "Next card")),
    el("h2", {}, "All cards"),
    el("ol", { class: "cards" }, deck.cards.map((c, i) => el("li", { class: i === index ? "here" : null },
      el("a", { href: at(i) }, c.title), p.seen[c.id] ? el("span", { class: "muted small" }, " · read") : null))),
    el("p", { class: "small" }, el("a", { href: `#/foundations/${deck.id}/quiz` }, `Primer quiz: ${deck.quiz.length} questions`),
      p.attempts ? ` · best ${percent(p.best)}` : ""),
    brief ? el("p", { class: "center small" }, el("a", { href: "#/" }, "Back to the brief")) : null);
}

/* Primer quiz: held in memory, so leaving it starts it again. It can be retaken at any time;
   the best score is the one that counts for the badge. */
let primerQuiz = null;   // { deck, index, picks: [] }

function showPrimerQuiz(deck) {
  if (!primerQuiz || primerQuiz.deck !== deck || primerQuiz.finished) primerQuiz = { deck, index: 0, picks: [] };
  showPrimerQuestion();
}

function showPrimerQuestion() {
  const { deck, index, picks } = primerQuiz;
  if (index >= deck.quiz.length) return finishPrimerQuiz();
  const q = deck.quiz[index];
  const card = deck.cards.find((c) => c.id === q.concept);
  const feedback = el("div");
  const opts = el("div", { class: "options" });
  const next = el("button", { onclick: () => { primerQuiz.index++; showPrimerQuestion(); } }, index + 1 === deck.quiz.length ? "Finish" : "Next");
  next.hidden = true;
  function reveal() {
    const ok = picks[index] === q.answer;
    [...opts.children].forEach((b, i) => {
      b.disabled = true; b.style.opacity = 1;
      if (i === q.answer) b.classList.add("right");
      else if (i === picks[index]) b.classList.add("wrong");
    });
    feedback.replaceChildren(el("div", { class: "feedback" },
      el("div", { class: ok ? "ok" : "no" }, ok ? "Correct" : "Not quite"),
      el("p", {}, `${sentence(q.options[q.answer])} ${q.explanation}`),
      card ? el("p", { class: "small" }, "From the card: ", card.title) : null));
    next.hidden = false;
  }
  q.options.forEach((text, i) => opts.append(el("button", { class: "opt", onclick: () => {
    if (picks[index] != null) return;
    picks[index] = i;
    reveal();
  } }, text)));
  render(
    el("p", { class: "small crumbs" }, el("a", { href: "#/foundations" }, "Foundations"), " › ", el("a", { href: `#/foundations/${deck.id}` }, deck.label), " › Quiz"),
    el("div", { class: "muted small" }, `Question ${index + 1} of ${deck.quiz.length}`),
    el("div", { class: "progress" }, el("i", { style: `width:${(index / deck.quiz.length) * 100}%` })),
    el("h3", {}, q.question), opts, feedback, next);
  if (picks[index] != null) reveal();
}

function finishPrimerQuiz() {
  const { deck, picks } = primerQuiz;
  primerQuiz.finished = true;
  const total = deck.quiz.length;
  const missed = deck.quiz.filter((q, i) => picks[i] !== q.answer);
  const right = total - missed.length;
  const p = primerState(deck.id);
  const wasPassed = passed(deck.id);
  p.attempts++;
  p.last = right / total;
  if (p.last > p.best) p.best = p.last;
  if (!wasPassed && p.best >= PRIMER_PASS) p.passedAt = new Date().toISOString();
  save();
  const ok = p.last >= PRIMER_PASS;
  const cards = [...new Set(missed.map((q) => q.concept))].map((id) => deck.cards.find((c) => c.id === id)).filter(Boolean);
  render(
    el("p", { class: "small crumbs" }, el("a", { href: "#/foundations" }, "Foundations"), " › ", el("a", { href: `#/foundations/${deck.id}` }, deck.label), " › Quiz"),
    el("h1", {}, ok ? "Foundations complete" : "Not there yet"),
    el("div", { class: "big" }, `${right} / ${total}`),
    el("p", { class: "muted" }, ok ? `${deck.label}: ${percent(p.last)}. ` : `${percent(p.last)}. The badge needs ${passMark(total)} of ${total} (${percent(PRIMER_PASS)}). `,
      !ok && wasPassed ? `Your badge stays: your best score is ${percent(p.best)}.` : ""),
    ok || wasPassed ? el("p", {}, badge()) : null,
    cards.length ? el("h2", {}, "Cards to read again") : null,
    cards.length ? el("ul", {}, cards.map((c) => el("li", {}, el("a", { href: `#/foundations/${deck.id}/${c.id}` }, c.title)))) : null,
    el("div", { class: "row two" },
      el("button", { class: "ghost", onclick: () => { primerQuiz = null; showPrimerQuiz(deck); } }, "Retake the quiz"),
      el("a", { class: "btn", href: "#/foundations" }, "All decks")));
}

async function routeFoundations(parts) {
  if (!primers) {
    try { await loadPrimers(); } catch (e) {
      return render(el("h1", {}, "Foundations"), nav("foundations"),
        el("p", { class: "muted" }, "Could not load the Foundations decks. Check your connection and try again."),
        el("button", { onclick: route }, "Try again"));
    }
  }
  const deck = primers.decks.find((d) => d.id === parts[0]);
  if (!deck) return showFoundations();
  if (parts[1] === "quiz") return showPrimerQuiz(deck);
  showDeck(deck, parts[1]);
}

/* ---------- shared by Archive and Progress ---------- */

function topicList() { return brief ? brief.topics : DEFAULT_TOPICS; }
function topicLabel(id) { return (topicList().find((t) => t.id === id) || DEFAULT_TOPICS.find((t) => t.id === id) || { label: id }).label; }
function tally(list) {   // answers -> { right, total, byTopic: { id: [right, total] } }
  const out = { right: 0, total: 0, byTopic: {} };
  for (const a of list) {
    const t = (out.byTopic[a.topic] = out.byTopic[a.topic] || [0, 0]);
    t[1]++; out.total++;
    if (a.ok) { t[0]++; out.right++; }
  }
  return out;
}
function scoreText(right, total) { return `${right} / ${total} (${percent(right / total)})`; }
function topicScores(t) {   // list items in the brief's topic order
  return topicList().filter((x) => t.byTopic[x.id]).map((x) => el("li", {}, `${x.label}: ${scoreText(...t.byTopic[x.id])}`));
}
async function needPrimers() { if (!primers) { try { await loadPrimers(); } catch (e) { /* concepts show as plain labels */ } } }

/* ---------- Archive ---------- */

let monthsLoaded = 2;   // Archive list: this month and last to start with; "Show earlier" adds one at a time

async function archiveEntry(date) {
  const a = await archiveMonth(date.slice(0, 7));
  return (a && a.days.find((d) => d.date === date)) || null;
}
function isFullDay(date) { const today = ukToday(); return date <= today && date >= addDays(today, -FULL_DAYS); }
/* A past day's own questions: from the archive (kept for good), or from the daily file if the archive lacks the day. */
async function pastQuestions(date) {
  const entry = await archiveEntry(date);
  if (entry && entry.questions.length) return entry.questions.map((q) => Object.assign({ isReview: false }, q));
  const full = isFullDay(date) ? await dailyFile(date) : null;
  return full ? questionsOf(full) : [];
}
function dayScore(date) {   // "7 / 10" for a finished day, else null
  const day = state.days[date];
  if (!day || !day.done) return null;
  const t = tally(Object.values(day.answers));
  return `${t.right} / ${t.total}`;
}

async function showArchive() {
  const at = location.hash;
  const today = ukToday();
  const current = brief ? brief.date : null;   // the day on the Today screen is not listed here
  const dates = [];
  for (let i = 0; i <= FULL_DAYS; i++) dates.push(addDays(today, -i));
  const months = [];
  for (let i = 0; i < monthsLoaded; i++) months.push(addMonths(today.slice(0, 7), -i));
  const [fulls, archives] = await Promise.all([Promise.all(dates.map(dailyFile)), Promise.all(months.map(archiveMonth))]);
  if (location.hash !== at) return;

  const row = (date, count, kind) => {
    const score = dayScore(date);
    return el("a", { class: "card day", href: `#/archive/${date}` },
      el("h3", {}, longDate(date)),
      el("div", { class: "meta" },
        el("span", { class: "muted" }, `${count} stories · ${kind}`),
        score ? el("span", { class: "badge" }, `Quiz ${score}`) : null));
  };
  const recent = fulls.filter((b) => b && b.date !== current);
  const inFull = new Set(recent.map((b) => b.date));
  const older = archives.filter(Boolean).flatMap((a) => a.days)
    .filter((d) => d.date !== current && !inFull.has(d.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  // stop offering earlier months once a month before this one is missing
  const more = archives.length > 1 && archives[archives.length - 1] !== null;

  render(
    el("header", { class: "top" }, el("div", {}, el("h1", {}, "Archive"),
      el("div", { class: "muted small" }, "Past briefs and their quizzes"))),
    nav("archive"),
    el("h2", {}, `Last ${FULL_DAYS} days`),
    recent.length ? recent.map((b) => row(b.date, b.stories.length, "full brief"))
      : el("p", { class: "muted" }, "No earlier briefs in the last 7 days yet."),
    el("h2", {}, "Older"),
    older.length ? older.map((d) => row(d.date, d.stories.length, "headlines and quiz"))
      : el("p", { class: "muted" }, "Nothing older yet. After 7 days a brief is kept as headlines, links and its quiz."),
    more ? el("div", { class: "row" }, el("button", { class: "ghost", onclick: () => { monthsLoaded++; showArchive(); } }, "Show earlier")) : null);
}

async function showArchiveDay(date) {
  const at = location.hash;
  if (brief && date === brief.date) { location.hash = "#/"; return; }
  const [full, entry, questions] = await Promise.all([isFullDay(date) ? dailyFile(date) : null, archiveEntry(date), pastQuestions(date)]);
  if (location.hash !== at) return;
  const head = el("p", { class: "small crumbs" }, el("a", { href: "#/archive" }, "Archive"), " › ", longDate(date));
  if (!full && !entry) {
    return render(head, el("h1", {}, longDate(date)), el("p", { class: "muted" }, "There is no brief for this day."),
      el("div", { class: "row" }, el("a", { class: "btn", href: "#/archive" }, "Back to the archive")));
  }
  const parts = [head, el("h1", {}, longDate(date))];
  if (full) {
    parts.push(el("div", { class: "muted small" }, `${full.stories.length} stories · about ${full.read_minutes} min`));
    for (const t of full.topics) {
      const stories = full.stories.filter((s) => s.topic === t.id);
      const idea = t.id === "macro_markets" && full.market_idea;
      if (!stories.length && !idea) continue;
      parts.push(el("h2", {}, t.label), ...stories.map(storyNode));
      if (idea) parts.push(marketIdea(full.market_idea));
    }
  } else {
    parts.push(el("div", { class: "muted small" }, `${entry.stories.length} stories · headlines and links`));
    const ids = topicList().map((t) => t.id);
    for (const id of ids.concat([...new Set(entry.stories.map((s) => s.topic))].filter((x) => !ids.includes(x)))) {
      const stories = entry.stories.filter((s) => s.topic === id);
      if (!stories.length) continue;
      parts.push(el("h2", {}, topicLabel(id)), el("ul", { class: "headlines" },
        stories.map((s) => el("li", {}, link(s.url, s.headline), el("span", { class: "muted small" }, ` · ${s.source}`)))));
    }
  }
  const end = el("section", { class: "end" });
  const day = state.days[date];
  const quizHref = `#/archive/${date}/quiz`;
  if (!questions.length) end.append(el("p", { class: "muted center" }, "No quiz that day."));
  else if (day && day.done) {
    end.append(el("p", { class: "center" }, `Your score: ${dayScore(date)}`),
      el("a", { class: "btn", href: quizHref }, "Retake the quiz"),
      el("p", { class: "muted small center" }, "A retake is practice: it does not change your score, streak or review queue."));
  } else {
    const started = day && Object.keys(day.answers).length > 0;
    end.append(el("a", { class: "btn", href: quizHref }, started ? "Continue the quiz" : "Take the quiz"),
      el("p", { class: "muted small center" }, `${questions.length} questions. Counts towards your scores and review queue, not your streak.`));
  }
  parts.push(end);
  render(...parts);
}

/* A past day's quiz. Not taken before: a late first attempt, saved answer by answer like the daily quiz,
   scored and fed into the review queue, but never a streak day. Already finished: a practice retake,
   held in memory and recorded nowhere. */
let pastQuiz = null;   // { date, questions, practice, picks: {qid: i}, index, finished }

async function showPastQuiz(date) {
  const at = location.hash;
  if (brief && date === brief.date) { location.hash = "#/quiz"; return; }
  const questions = await pastQuestions(date);
  if (location.hash !== at) return;
  if (!questions.length) { location.hash = `#/archive/${date}`; return; }
  const day = state.days[date];
  if (!pastQuiz || pastQuiz.date !== date || pastQuiz.finished) {
    pastQuiz = { date, questions, practice: !!(day && day.done), picks: {}, index: 0 };
    if (!pastQuiz.practice && day) {   // resume a quiz left half way
      const i = questions.findIndex((q) => !(q.id in day.answers));
      pastQuiz.index = i < 0 ? questions.length : i;
    }
  }
  showPastQuestion();
}

function showPastQuestion() {
  const { date, questions, index, practice, picks } = pastQuiz;
  if (index >= questions.length) return finishPastQuiz();
  const q = questions[index];
  const answers = () => (state.days[date] ? state.days[date].answers : {});
  questionScreen({
    head: el("p", { class: "small crumbs" }, el("a", { href: "#/archive" }, "Archive"), " › ",
      el("a", { href: `#/archive/${date}` }, longDate(date)), practice ? " › Practice quiz" : " › Quiz"),
    q, index, total: questions.length,
    picked: () => (practice ? (q.id in picks ? picks[q.id] : null) : (q.id in answers() ? answers()[q.id].pick : null)),
    onPick: (i) => { if (practice) picks[q.id] = i; else record(date, q, i); },
    onNext: () => { pastQuiz.index++; showPastQuestion(); },
    missNote: practice ? null : "This one comes back for review." });
}

function finishPastQuiz() {
  const { date, questions, practice, picks } = pastQuiz;
  pastQuiz.finished = true;
  let list;
  if (practice) list = questions.map((q) => ({ topic: q.topic, ok: picks[q.id] === q.answer }));
  else {
    const day = state.days[date];
    if (!day.done) { day.done = true; day.late = true; day.completedAt = new Date().toISOString(); save(); }
    list = Object.values(day.answers);
  }
  const t = tally(list);
  render(
    el("p", { class: "small crumbs" }, el("a", { href: "#/archive" }, "Archive"), " › ", el("a", { href: `#/archive/${date}` }, longDate(date)), " › Quiz"),
    el("h1", {}, practice ? "Practice done" : "Done"),
    el("div", { class: "big" }, `${t.right} / ${t.total}`),
    el("p", { class: "muted" }, practice
      ? `Practice run, not recorded. Your recorded score for this day is ${dayScore(date)}.`
      : "Recorded in your scores, and missed questions join your review queue. A quiz taken late does not count towards the streak."),
    el("ul", {}, topicScores(t)),
    el("div", { class: "row two" },
      el("button", { class: "ghost", onclick: () => { pastQuiz = null; showPastQuiz(date); } }, "Retake as practice"),
      el("a", { class: "btn", href: "#/archive" }, "Archive")));
}

async function routeArchive(parts) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0] || "")) return showArchive();
  await needPrimers();   // concept tags on a full day link to their cards
  if (parts[1] === "quiz") return showPastQuiz(parts[0]);
  return showArchiveDay(parts[0]);
}

/* ---------- Progress ---------- */

/* Every recorded answer between two dates (inclusive), by the day it is stored under. Review answers and
   late Archive quizzes count; practice retakes are never stored. */
function answersBetween(from, to) {
  const out = [];
  for (const [date, day] of Object.entries(state.days)) {
    if (date >= from && date <= to) for (const a of Object.values(day.answers)) out.push(a);
  }
  return out;
}
/* Concepts ranked by how often they were missed (ties: the higher miss rate first). */
function mostMissed(list, n) {
  const by = {};
  for (const a of list) {
    if (!a.concept) continue;
    const c = (by[a.concept] = by[a.concept] || { id: a.concept, missed: 0, asked: 0 });
    c.asked++; if (!a.ok) c.missed++;
  }
  return Object.values(by).filter((c) => c.missed > 0)
    .sort((a, b) => b.missed - a.missed || b.missed / b.asked - a.missed / a.asked || a.id.localeCompare(b.id)).slice(0, n);
}
function missedList(items) {
  return el("ol", { class: "missed" }, items.map((c) => {
    const deck = primers && primers.where[c.id];
    const card = deck && deck.cards.find((x) => x.id === c.id);
    return el("li", {},
      card ? el("a", { href: `#/foundations/${deck.id}/${c.id}` }, card.title) : c.id.replace(/_/g, " "),
      el("div", { class: "muted small" }, `Missed ${c.missed} of ${c.asked}${deck ? ` · ${deck.label}` : ""}`));
  }));
}

function recapSection(monday) {
  const today = ukToday();
  const thisWeek = mondayOf(today);
  const sunday = addDays(monday, 6);
  const dots = el("div", { class: "week", role: "img" });
  let counted = 0, late = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const day = state.days[d];
    const on = !!(day && day.done && !day.late);
    const isLate = !!(day && day.done && day.late);
    if (on) counted++;
    if (isLate) late++;
    dots.append(el("div", { class: "dot" + (on ? " on" : isLate ? " late" : "") + (d > today ? " future" : "") },
      el("i", {}, on ? "✓" : isLate ? "L" : ""), el("span", {}, "MTWTFSS"[i])));
  }
  const summary = `${counted} of 7 days completed` + (late ? `, ${late} more done late` : "");
  dots.setAttribute("aria-label", summary);
  const list = answersBetween(monday, sunday);
  const t = tally(list);
  const missed = mostMissed(list, MOST_MISSED);
  return el("section", { class: "card recap" },
    el("div", { class: "muted small" }, monday === thisWeek ? "This week" : monday === addDays(thisWeek, -7) ? "Last week" : "Week",
      ` · ${shortDate(monday)} to ${shortDate(sunday)}`),
    el("h3", {}, "Weekly recap"),
    dots,
    el("p", {}, el("b", {}, summary), late ? el("span", { class: "muted small" }, " (L: quiz taken late, not a streak day)") : null),
    el("h4", {}, "Score by topic"),
    t.total ? [el("p", {}, `All topics: ${scoreText(t.right, t.total)}`), el("ul", {}, topicScores(t))]
      : el("p", { class: "muted" }, monday === thisWeek ? "No quiz answers this week yet." : "No quiz answers that week."),
    el("h4", {}, "Most-missed concepts"),
    missed.length ? [missedList(missed), el("p", { class: "muted small" }, "Each links to its Foundations card.")]
      : el("p", { class: "muted" }, t.total ? "No concept missed. Nothing to revise." : "Nothing to show yet."),
    el("div", { class: "row two" },
      el("a", { class: "btn ghost", href: `#/progress/week/${addDays(monday, -7)}` }, "‹ Earlier week"),
      monday < thisWeek ? el("a", { class: "btn ghost", href: addDays(monday, 7) === thisWeek ? "#/progress" : `#/progress/week/${addDays(monday, 7)}` }, "Later week ›") : el("span")));
}

/* Score by topic over time: one small bar chart per topic, one bar per week (Monday to Sunday),
   all on the same 0–100% scale with the 70% target marked. Tap or hover a bar for its numbers. */
function topicChart(label, weeks, pick) {
  const all = weeks.reduce((s, w) => [s[0] + pick(w)[0], s[1] + pick(w)[1]], [0, 0]);
  const text = (w) => { const [r, n] = pick(w); return `Week of ${shortDate(w.monday)}: ${n ? scoreText(r, n) : "no questions"}`; };
  const detail = el("div", { class: "muted small detail" }, text(weeks[weeks.length - 1]));
  const bars = el("div", { class: "bars" }, el("div", { class: "target" }));
  for (const w of weeks) {
    const [r, n] = pick(w);
    const show = () => { detail.textContent = text(w); [...bars.children].forEach((b) => b.classList.toggle("sel", b === col)); };
    const col = el("button", { class: "col", "aria-label": text(w), onclick: show, onmouseenter: show, onfocus: show },
      n ? el("i", { style: `height:${Math.max((r / n) * 100, 3)}%` }) : el("i", { class: "none" }));
    bars.append(col);
  }
  bars.lastChild.classList.add("sel");
  return el("div", { class: "chart" },
    el("div", { class: "chart-head" }, el("b", {}, label), el("span", {}, all[1] ? scoreText(...all) : "no questions")),
    bars, detail);
}

function trendSection() {
  const dates = Object.keys(state.days).filter((d) => Object.keys(state.days[d].answers).length).sort();
  if (!dates.length) return el("p", { class: "muted" }, "Finish a quiz and your scores will build up here, week by week.");
  const thisWeek = mondayOf(ukToday());
  let first = mondayOf(dates[0]);
  if (first < addDays(thisWeek, -7 * (WEEKS_SHOWN - 1))) first = addDays(thisWeek, -7 * (WEEKS_SHOWN - 1));
  const weeks = [];
  for (let m = first; m <= thisWeek; m = addDays(m, 7)) weeks.push(Object.assign({ monday: m }, tally(answersBetween(m, addDays(m, 6)))));
  const topics = topicList().filter((t) => weeks.some((w) => w.byTopic[t.id]));
  return [
    el("p", { class: "muted small" }, `One bar per week, ${shortDate(weeks[0].monday)} to now. Dashed line: the ${percent(TARGET)} target. Tap a bar for its numbers.`),
    topicChart("All topics", weeks, (w) => [w.right, w.total]),
    ...topics.map((t) => topicChart(t.label, weeks, (w) => w.byTopic[t.id] || [0, 0]))];
}

async function showProgress(week) {
  const at = location.hash;
  await needPrimers();   // concept names and links to their cards
  if (location.hash !== at) return;
  const today = ukToday();
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(week || "") && week <= today ? mondayOf(week) : mondayOf(today);
  const n = streak();
  const all = tally(answersBetween("0000", "9999"));
  const stat = (value, label) => el("div", { class: "stat" }, el("b", {}, value), el("span", { class: "muted small" }, label));
  const missed = mostMissed(answersBetween("0000", "9999"), 5);
  render(
    el("header", { class: "top" }, el("div", {}, el("h1", {}, "Progress"),
      el("div", { class: "muted small" }, "Stored on this device only"))),
    nav("progress"),
    el("div", { class: "stats" },
      stat(String(n), "day streak"), stat(String(longestStreak()), "longest streak"),
      stat(String(countedDays().length), "days completed"), stat(all.total ? percent(all.right / all.total) : "–", "average score")),
    recapSection(monday),
    el("h2", {}, "Score by topic over time"), trendSection(),
    el("h2", {}, "Most-missed concepts, all time"),
    missed.length ? missedList(missed) : el("p", { class: "muted" }, "Nothing missed yet."),
    footer());
}

/* ---------- export / import progress ---------- */

function footer() {
  const file = el("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: importFile });
  return el("footer", { class: "muted small" },
    el("div", {}, "Your scores and streak are stored on this device only."),
    el("div", { class: "row" },
      el("button", { class: "ghost inline", onclick: exportFile }, "Export progress"),
      el("button", { class: "ghost inline", onclick: () => file.click() }, "Import progress"), file));
}
function exportFile() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `daily-brief-progress-${ukToday()}.json` });
  document.body.append(a); a.click(); a.remove();
}
async function importFile(ev) {
  const f = ev.target.files[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!s || s.v !== 1 || typeof s.days !== "object" || typeof s.queue !== "object") throw new Error("shape");
    s.primers = s.primers || {};
    state = s; save();
    alert("Progress imported.");
    route();
  } catch (e) { alert("That file is not a Daily Brief progress export."); }
}

/* ---------- router ---------- */

async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  try {
    if (parts[0] === "foundations") return await routeFoundations(parts.slice(1));   // works without a brief
    if (parts[0] === "archive") return await routeArchive(parts.slice(1));
    if (parts[0] === "progress") return await showProgress(parts[1] === "week" ? parts[2] : null);
    if (!brief) return briefError ? showError(briefError) : undefined;
    if (parts[0] === "quiz") await showQuiz();
    else await showToday();
  } catch (e) { showError(e); }
}
function showError(e) {
  render(el("h1", {}, "Daily Brief"), nav("today"), el("p", { class: "muted" }, "Could not load the brief. Check your connection and try again."),
    el("button", { onclick: start }, "Try again"), el("p", { class: "muted small" }, String(e.message || e)));
}
let briefError = null;
async function start() {
  briefError = null;
  // The decks are loaded alongside the brief so concept tags can link to their cards;
  // if they fail to load, the tags stay plain labels and the brief still shows.
  const decks = primers ? null : loadPrimers().catch(() => {});
  try { brief = await loadBrief(); loadedOn = ukToday(); } catch (e) { briefError = e; }
  await decks;
  route();
}
window.addEventListener("hashchange", route);
// coming back to the app on a new day should refresh the brief and streak
document.addEventListener("visibilitychange", () => { if (!document.hidden && brief && loadedOn !== ukToday()) start(); });
start();
