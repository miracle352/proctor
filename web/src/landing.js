import "./fonts.js";
import "./base.css";
import "./landing.css";
import { load, modelName, makerName, setLabel, isTwin, isOriginal, short, near, esc, $, $$, still, wait, LOGO, ICON, countUp, EXPLORER } from "./chain.js";

$$(".logo-slot, .env-seal").forEach((el) => (el.innerHTML = LOGO));
let D = null;

/* headline: words rise in one after another */
const h1 = $("#hero-h");
let wi = 0;
for (const part of h1.children) {
  part.innerHTML = part.textContent.split(" ").map((w) => `<span class="w" style="--i:${wi++}">${w}</span>`).join(" ");
}

/* scroll: sticky nav, the hall drifting, the window lying flat */
const nav = $("#nav"), hall = $(".hall"), win = $("#window");
let sy = scrollY;
addEventListener("scroll", () => (sy = scrollY), { passive: true });

/* the proctor's lamp: follows the pointer over the hall, wanders when left alone */
const lamp = { x: 0.68, y: 0.42, tx: 0.68, ty: 0.42, last: 0 };
addEventListener("pointermove", (e) => {
  if (e.clientY > innerHeight * 1.1) return;
  lamp.tx = e.clientX / innerWidth; lamp.ty = (e.clientY + sy) / hall.offsetHeight; lamp.last = performance.now();
}, { passive: true });

function frame(now) {
  nav.classList.toggle("stuck", sy > 20);
  const vh = innerHeight;
  if (sy < vh * 1.4) {
    if (now - lamp.last > 2500 && !still) {
      const t = now / 1000;
      lamp.tx = 0.5 + Math.sin(t * 0.23) * 0.32 + Math.sin(t * 0.61) * 0.06;
      lamp.ty = 0.42 + Math.sin(t * 0.37 + 1) * 0.16;
    }
    lamp.x += (lamp.tx - lamp.x) * 0.06; lamp.y += (lamp.ty - lamp.y) * 0.06;
    hall.style.setProperty("--mx", `${(lamp.x * 100).toFixed(2)}%`);
    hall.style.setProperty("--my", `${(lamp.y * 100).toFixed(2)}%`);
    hall.style.setProperty("--r", `${Math.round(Math.max(200, innerWidth * 0.2))}px`);
    const px = (lamp.x - 0.5) * -18, py = sy * 0.18 + (lamp.y - 0.4) * -10;
    hall.style.setProperty("--px", `${px.toFixed(1)}px`);
    hall.style.setProperty("--py", `${py.toFixed(1)}px`);
    hall.style.setProperty("--zoom", (1.06 + Math.min(sy / vh, 1) * 0.05).toFixed(4));
    const r = win.getBoundingClientRect();
    const tilt = Math.max(0, Math.min(1, (r.top - vh * 0.18) / (vh * 0.55)));
    win.style.setProperty("--tilt", still ? 0 : tilt.toFixed(3));
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* things that fade up once they're on screen */
const reveal = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); }
}), { threshold: 0.18 });
$$(".twins h2, .twins .sub, .pair, .sec-head, .writers-grid > *, .earn li, .door, .faq-list, .close h2").forEach((el) => { el.classList.add("reveal"); reveal.observe(el); });

/* the product window: replays recorded exams, one after another */
function groupsOf(d) {
  const g = {};
  for (const c of d.certs) (g[`${c.model}|${c.set_id}`] ||= []).push(c);
  return Object.values(g).map((list) => {
    const byQ = new Map();
    for (const c of list.sort((a, b) => a.id - b.id)) if (!byQ.has(c.start)) byQ.set(c.start, c);
    return { model: list[0].model, set_id: list[0].set_id, sealed: list[0].sealed, byQ, qs: [...byQ.keys()].sort((a, b) => a - b) };
  }).filter((g) => g.qs.length >= 10);
}
async function windowLoop() {
  const groups = groupsOf(D);
  if (!groups.length) return;
  const models = [...new Set(groups.map((g) => g.model))];
  $("#w-models").innerHTML = models.map((m) => `<span data-m="${esc(m)}">${esc(modelName(m))}</span>`).join("");
  // show different makers back to back
  const order = []; const pools = models.map((m) => groups.filter((g) => g.model === m));
  for (let i = 0; order.length < groups.length; i++) for (const p of pools) if (p[i]) order.push(p[i]);
  for (let k = 0; ; k = (k + 1) % order.length) {
    const g = order[k], qs = g.qs.slice(0, 16);
    $$("#w-models span").forEach((s) => s.classList.toggle("on", s.dataset.m === g.model));
    $("#w-set").textContent = setLabel(g.set_id);
    $("#w-kick").textContent = `${modelName(g.model)}, ${g.sealed ? "inside secure hardware" : `on ${makerName(g.model)}'s servers`}`;
    $("#w-title").textContent = "Answering sealed questions";
    $("#w-score").textContent = "0"; $("#w-of").textContent = `of ${qs.length} right`;
    $("#w-bar").style.setProperty("--v", "0%");
    $("#w-stamp").classList.remove("in"); $("#w-block").textContent = "waiting for the marks";
    $("#w-sheet").innerHTML = qs.map((q, i) => `<li class="ask"><span>Q${q + 1}</span><span class="ink" style="--w:${40 + ((q * 37 + i * 11) % 55)}%"></span><span class="mk"></span></li>`).join("");
    const rows = $$("#w-sheet li");
    await wait(1500);
    let right = 0;
    for (const [i, q] of qs.entries()) {
      const c = g.byQ.get(q), ch = c.results[0];
      const s = ch === "1" ? "right" : ch === "0" ? "wrong" : "none";
      rows[i].className = s; rows[i].querySelector(".mk").className = `mk ${s}`; rows[i].querySelector(".mk").innerHTML = ICON[s];
      if (ch === "1") $("#w-score").textContent = ++right;
      $("#w-bar").style.setProperty("--v", `${(100 * (i + 1)) / qs.length}%`);
      await wait(170);
    }
    const last = g.byQ.get(qs[qs.length - 1]);
    $("#w-title").textContent = `${right} of ${qs.length} right, marked by code`;
    $("#w-block").textContent = `${qs.length} certificates, last in block ${last.block_height.toLocaleString()}`;
    $("#w-stamp").classList.add("in");
    await wait(3200);
  }
}

/* ticker of the newest certificates */
function renderTicker() {
  // newest first, taking turns between models so one long run doesn't fill the strip
  const by = {};
  for (const c of D.newest) (by[c.model] ||= []).push(c);
  const lists = Object.values(by), mixed = [];
  for (let i = 0; mixed.length < 24 && i < 40; i++) for (const l of lists) if (l[i] && mixed.length < 24) mixed.push(l[i]);
  const items = mixed.map((c) => {
    const s = c.results[0] === "1" ? "right" : c.results[0] === "0" ? "wrong" : "none";
    return `<a class="tick" href="/app#check?cert=${c.id}"><span class="mk ${s}">${ICON[s]}</span><b>${esc(modelName(c.model))}</b><span>${esc(setLabel(c.set_id))}, Q${c.start + 1}</span><small>#${c.id}</small></a>`;
  }).join("");
  $("#ticker").innerHTML = items + items;
}

/* the walkthrough: the stage follows whichever step is in the middle of the screen */
const stage = $("#stage"), steps = $$("#how-steps li");
let current = -1;
function setStep(n) {
  if (n === current) return;
  current = n;
  stage.dataset.step = n;
  steps.forEach((li, i) => { li.classList.toggle("on", i === n); li.classList.toggle("past", i < n); });
  if (n === 0) typeQuestion();
  if (n === 2) scrambleHash();
  if (n === 3) cycleModels();
}
// On a phone the stage is pinned over the top half, so steps count once they reach the lower part.
const narrow = matchMedia("(max-width: 1000px)").matches;
const stepIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setStep(+e.target.dataset.step); }), { rootMargin: narrow ? "-70% 0px -25% 0px" : "-45% 0px -45% 0px" });
steps.forEach((li) => stepIO.observe(li));
setStep(0);

let typing = 0;
async function typeQuestion() {
  const my = ++typing, el = $("#typed");
  const text = "A train leaves at 09:40 and arrives at 13:15 the same day. How many minutes is the trip?";
  el.textContent = "";
  for (let i = 1; i <= text.length && my === typing; i++) { el.textContent = text.slice(0, i); await wait(22); }
}
let scrambling = 0;
async function scrambleHash() {
  const my = ++scrambling, el = $("#hash");
  const target = D ? (Object.values(D.sets).find((s) => s.size > 10)?.sha256 || Object.values(D.sets)[0].sha256) : "0".repeat(64);
  const hex = "0123456789abcdef";
  for (let f = 0; f <= 34 && my === scrambling; f++) {
    const fixed = Math.floor((f / 34) * 64);
    el.innerHTML = [...target].map((ch, i) => i < fixed ? ch : `<span class="x">${hex[(Math.random() * 16) | 0]}</span>`).join("");
    await wait(32);
  }
}
let cycling = 0;
async function cycleModels() {
  const my = ++cycling, names = D ? [...new Set(D.certs.map((c) => modelName(c.model)))] : ["Qwen 3.8"];
  for (let i = 0; my === cycling && current === 3; i++) {
    $("#sit-model").outerHTML = `<span id="sit-model">${esc(names[i % names.length])}</span>`;
    await wait(1400);
  }
}
function fillStageData() {
  $("#seal-build").textContent = short(D.config.grader_version, 6);
  const set = Object.entries(D.sets).find(([, s]) => s.size > 10) || Object.entries(D.sets)[0];
  $("#commit-set").textContent = `${setLabel(set[0])} committed on NEAR`;
  $("#commit-meta").textContent = `${set[1].size} questions, ${near(set[1].stake)} NEAR staked by ${short(set[1].keeper, 8)}`;
  const g = groupsOf(D)[0];
  if (g) {
    const qs = g.qs.slice(0, 12);
    $("#marks").innerHTML = qs.map((q, i) => { const ch = g.byQ.get(q).results[0], s = ch === "1" ? "right" : ch === "0" ? "wrong" : "none"; return `<span class="${s}"><span class="mk ${s}" style="--i:${i}">${ICON[s]}</span></span>`; }).join("");
    const last = g.byQ.get(qs[qs.length - 1]);
    $("#cert-card").innerHTML = `<b>Certificate #${last.id}</b><span>${esc(modelName(g.model))}, block ${last.block_height.toLocaleString()}. Writer paid ${near(last.paid_to_authors)} NEAR.</span>`;
  }
  if (current === 2) scrambleHash();
}

/* twins: the same problem, regenerated with fresh names and numbers */
const NAMES = [["Lena", "she"], ["Tomás", "he"], ["Aiko", "she"], ["Kwame", "he"], ["Priya", "she"], ["Mateo", "he"], ["Sofia", "she"], ["Arjun", "he"], ["Noor", "she"], ["Liam", "he"]];
const THINGS = [["boxes", "pencils"], ["crates", "apples"], ["packs", "stickers"], ["bags", "marbles"], ["trays", "eggs"]];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function problem(fixed) {
  const [name, pr] = fixed ? NAMES[0] : NAMES[rnd(1, NAMES.length - 1)];
  const [box, item] = fixed ? THINGS[0] : THINGS[rnd(0, THINGS.length - 1)];
  const a = fixed ? 4 : rnd(3, 9), b = fixed ? 12 : rnd(11, 19), c = fixed ? 9 : rnd(2, 9);
  return `<mark>${name}</mark> buys <mark>${a}</mark> ${box} of <mark>${b}</mark> ${item} and gives away <mark>${c}</mark>. How many ${item} does ${pr} have left? <span class="ans">Answer: <mark>${a * b - c}</mark></span>`;
}
$("#q-pub").innerHTML = problem(true);
async function twinLoop() {
  for (;;) {
    $("#q-twin").innerHTML = problem(false);
    $$("#q-twin mark").forEach((m, i) => { m.style.animationDelay = `${i * 60}ms`; m.classList.add("flip"); });
    await wait(still ? 1e9 : 2600);
  }
}
twinLoop();

/* scores */
function renderBoard() {
  const ms = D.models.filter((m) => m.freshN > 0 || m.pubN > 0);
  const total = D.certs.length;
  $("#tally").textContent = `${total.toLocaleString()} certificates on NEAR from ${ms.length} AI models by ${new Set(ms.map((m) => makerName(m.model))).size} makers. Every bar below is read from the contract as the page opens.`;
  const pct = (x) => Math.round(100 * x);
  $("#board").innerHTML = ms.map((m, i) => {
    let verdict = "";
    if (m.gap) {
      const p = (x) => `${x > 0 ? "+" : ""}${(100 * x).toFixed(1)}`;
      verdict = m.gap.lo > 0
        ? `<p class="verdict"><strong>Looks like memorising.</strong> ${p(m.gap.mean)} points better on the version it could have seen.</p>`
        : `<p class="verdict"><strong>No sign of memorising.</strong> The difference is ${p(m.gap.mean)} points, within what chance explains.</p>`;
    }
    const head = m.freshN ? m.fresh : m.correct / m.asked;
    return `<article class="model" style="--i:${i}">
      <span class="rank">${i + 1}</span>
      <div><h3>${esc(modelName(m.model))}</h3><p class="maker">${esc(makerName(m.model))}</p>
        <span class="host ${m.sealed ? "" : "open"}">${m.sealed ? "Ran inside secure hardware" : `${esc(makerName(m.model))} saw the questions`}</span></div>
      <div class="duo">
        ${m.pubN ? `<div class="bar"><span>Published questions</span><i style="--v:${pct(m.pub)}%"></i><b>${pct(m.pub)}%</b></div>` : ""}
        ${m.freshN ? `<div class="bar fresh"><span>Its sealed twins</span><i style="--v:${pct(m.fresh)}%"></i><b>${pct(m.fresh)}%</b></div>` : ""}
        ${verdict}
      </div>
      <div class="big"><b data-n="${pct(head)}">0%</b><small>${m.freshN ? `on ${m.freshN} questions it had never seen` : `on ${m.asked} questions`}</small></div>
    </article>`;
  }).join("") || `<p class="sub">No exams recorded yet.</p>`;
  $$("#board .model").forEach((el) => { reveal.observe(el); countUp(el.querySelector(".big b"), +el.querySelector(".big b").dataset.n, { suffix: "%" }); });
}

function renderStats() {
  $("#live-count").textContent = `${D.certs.length.toLocaleString()} answers marked and recorded on NEAR`;
  countUp($("#paid"), Number(D.paid / 10n ** 21n) / 1000, { decimals: 3 });
  countUp($("#asked"), D.certs.reduce((a, c) => a + c.asked, 0));
  countUp($("#makers"), new Set(D.certs.map((c) => makerName(c.model))).size);
}

(async () => {
  try { D = await load(); } catch (err) {
    $("#live-count").textContent = "Couldn't reach NEAR just now";
    $("#board").innerHTML = `<p class="fail">Couldn't read the contract (${esc(err.message)}). Reload to try again.</p>`;
    return;
  }
  renderStats(); renderTicker(); renderBoard(); fillStageData();
  windowLoop();
})();
