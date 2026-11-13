"use strict";
/* Daily Brief: Today and Quiz screens. No framework, no build step.
   Progress (answers, streak, review queue) lives in localStorage on this device only. */

const KEY = "dailybrief.v1";
const BRIEF_BACK_DAYS = 8;      // how far back to look for the newest brief
const REVIEW_PER_DAY = 3;       // brief: up to 3 review questions a day
const REVIEW_STAGES = [3, 7];   // brief: back after 3 days, then 7 days if missed again
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

function emptyState() { return { v: 1, days: {}, queue: {} }; }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1 && s.days && s.queue) return s;
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

function topBar() {
  const n = streak();
  return el("header", { class: "top" },
    el("div", {}, el("h1", {}, "Daily Brief"), el("div", { class: "muted small" }, longDate(brief.date))),
    el("div", { class: "streak" }, el("b", {}, String(n)), el("span", { class: "muted small" }, "day streak")));
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
  if (s.concept) meta.append(el("span", { class: "tag" }, s.concept.label));
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
    el("p", { class: "small" }, link(m.url, `Based on: ${m.source}`)));
}

async function showToday() {
  const parts = [topBar()];
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
    state = s; save();
    alert("Progress imported.");
    route();
  } catch (e) { alert("That file is not a Daily Brief progress export."); }
}

/* ---------- router ---------- */

async function route() {
  if (!brief) return;
  try {
    if (location.hash.startsWith("#/quiz")) await showQuiz();
    else await showToday();
  } catch (e) { showError(e); }
}
function showError(e) {
  render(el("h1", {}, "Daily Brief"), el("p", { class: "muted" }, "Could not load the brief. Check your connection and try again."),
    el("button", { onclick: start }, "Try again"), el("p", { class: "muted small" }, String(e.message || e)));
}
async function start() {
  try { brief = await loadBrief(); loadedOn = ukToday(); } catch (e) { return showError(e); }
  route();
}
window.addEventListener("hashchange", route);
// coming back to the app on a new day should refresh the brief and streak
document.addEventListener("visibilitychange", () => { if (!document.hidden && brief && loadedOn !== ukToday()) start(); });
start();
