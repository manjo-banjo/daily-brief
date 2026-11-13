"use strict";
/* Daily Brief: Today, Quiz and Foundations screens. No framework, no build step.
   Progress (answers, streak, review queue, primer scores) lives in localStorage on this device only. */

const KEY = "dailybrief.v1";
const BRIEF_BACK_DAYS = 8;      // how far back to look for the newest brief
const REVIEW_PER_DAY = 3;       // brief: up to 3 review questions a day
const REVIEW_STAGES = [3, 7];   // brief: back after 3 days, then 7 days if missed again
const PRIMER_PASS = 0.8;        // brief: a deck is "foundations complete" at 80% or higher
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
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
}
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
function link(url, text) { return el("a", { href: safeUrl(url), target: "_blank", rel: "noopener noreferrer" }, text); }
function render(...nodes) { app.replaceChildren(...nodes); window.scrollTo(0, 0); }

/* Dates are plain YYYY-MM-DD strings; "today" is the UK calendar day. */
function ukToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()); }
function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
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
   newest finished day, and only counts while that day is today or yesterday. */
function streak() {
  const done = Object.keys(state.days).filter((d) => state.days[d].done).sort();
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
  return el("a", { class: "tag", href, onclick: () => { todayScroll = window.scrollY; } }, concept.label);
}
let todayScroll = 0;   // where the reader was in the brief when they opened a card
const archiveCache = {};
async function archiveMonth(month) {
  if (!(month in archiveCache)) archiveCache[month] = getJson(`data/archive/${month}.json`).catch(() => null);
  return archiveCache[month];
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
  const questions = brief.quiz.map((q) => Object.assign({ isReview: false, headline: storyOf(q.story_id).title, url: storyOf(q.story_id).url }, q)).concat(review);
  return { date, questions };
}
function storyOf(id) { return brief.stories.find((s) => s.id === id) || {}; }

function record(q, pick) {
  const day = state.days[brief.date];
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
  return el("nav", { class: "nav" }, item("today", "#/", "Today"), item("foundations", "#/foundations", "Foundations"));
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

function showQuestion() {
  const { questions, index } = session;
  if (index >= questions.length) return finishQuiz();
  const q = questions[index];
  const answers = state.days[brief.date].answers;
  const feedback = el("div");
  const opts = el("div", { class: "options" });
  const next = el("button", { onclick: () => { session.index++; showQuestion(); } }, index + 1 === questions.length ? "Finish" : "Next");
  next.hidden = true;

  q.options.forEach((text, i) => {
    const b = el("button", { class: "opt", onclick: () => {
      if (q.id in answers) return;
      record(q, i);
      reveal();
    } }, text);
    opts.append(b);
  });
  function reveal() {
    const a = answers[q.id];
    [...opts.children].forEach((b, i) => {
      b.disabled = true; b.style.opacity = 1;
      if (i === q.answer) b.classList.add("right");
      else if (i === a.pick) b.classList.add("wrong");
    });
    feedback.replaceChildren(el("div", { class: "feedback" },
      el("div", { class: a.ok ? "ok" : "no" }, a.ok ? "Correct" : "Not quite"),
      el("p", {}, `${q.options[q.answer]}. ${q.explanation}`),
      q.url ? el("p", { class: "small" }, link(q.url, `Back to the story: ${q.headline || ""}`)) : null,
      !a.ok ? el("p", { class: "muted small" }, "This one comes back for review.") : null));
    next.hidden = false;
  }

  render(
    el("div", { class: "muted small" }, `Question ${index + 1} of ${questions.length}`, q.isReview ? " · review" : ""),
    el("div", { class: "progress" }, el("i", { style: `width:${(index / questions.length) * 100}%` })),
    el("h3", {}, q.question), opts, feedback, next,
    el("p", { class: "center small" }, el("a", { href: "#/" }, "Back to the brief")));
  if (q.id in answers) reveal();
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
      el("p", {}, `${q.options[q.answer]}. ${q.explanation}`),
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
