import "./fonts.js";
import "./base.css";
import "./landing.css";
import { load, modelName, makerName, setLabel, isTwin, isOriginal, isHard, short, near, esc, $, $$, still, wait, LOGO, ICON, countUp, EXPLORER } from "./chain.js";
import PUBLISHED from "./published.json";

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
  // question -> each model's mark, from the certificates
  const marks = {};
  for (const c of D.certs) {
    [...c.results].forEach((ch, i) => {
      if (ch !== "0" && ch !== "1") return;
      const k = `${c.set_id}|${c.start + i}`;
      const m = (marks[k] ||= {});
      if (!(c.model in m)) m[c.model] = { r: ch === "1", cert: c.id, block: c.block_height };
    });
  }
  const models = D.models.filter((m) => m.sealedN || m.pubN).map((m) => m.model);
  const pub = Object.entries(PUBLISHED).flatMap(([sid, qs]) => qs.map((q, i) => ({ sid, i, ...q, key: `${sid}|${i}` }))).filter((q) => Object.keys(marks[q.key] || {}).length >= 2);
  const sealedKeys = Object.keys(marks).filter((k) => { const sid = k.split("|")[0]; return (isTwin(sid) || isHard(sid)) && Object.keys(marks[k]).length >= 2; });
  if (!pub.length) return;
  // show the questions some AI got wrong first, then the rest
  pub.sort((a, b) => Object.values(marks[a.key]).filter((v) => !v.r).length ? -1 : Object.values(marks[b.key]).filter((v) => !v.r).length ? 1 : 0);
  const paper = $(".paper-side");
  for (let k = 0; ; k++) {
    const sealed = k % 3 === 2 && sealedKeys.length;
    let key, sid, idx;
    if (sealed) { key = sealedKeys[(k / 3 | 0) % sealedKeys.length]; [sid, idx] = key.split("|"); idx = +idx; }
    else { const q = pub[(k - (k / 3 | 0)) % pub.length]; key = q.key; sid = q.sid; idx = q.i; }
    paper.classList.toggle("sealed", !!sealed);
    $("#ps-kick").textContent = sealed
      ? `${setLabel(sid)}, question ${idx + 1}. Sealed: nobody has seen it, and it stays locked until the set retires.`
      : `${setLabel(sid)}, question ${idx + 1}. This one has been online for years.`;
    if (sealed) {
      $("#ps-q").innerHTML = Array.from({ length: 16 }, (_, i) => `<span class="bar" style="--i:${i};width:${2 + ((idx * 7 + i * 13) % 6)}em"></span>`).join("");
      $("#ps-key").innerHTML = `<span>Answer key</span><b>Sealed too</b>`;
    } else {
      const q = PUBLISHED[sid][idx];
      $("#ps-q").innerHTML = q.q.split(" ").map((w, i) => `<span class="wd" style="--i:${i}">${esc(w)}</span>`).join(" ");
      $("#ps-key").innerHTML = `<span>Correct answer</span><b>${esc(q.a)}</b>`;
    }
    const m = marks[key];
    const shown = models.filter((x) => x in m);
    $("#ms-list").innerHTML = shown.map((x) => `<li class="wait"><span><b>${esc(modelName(x))}</b><small>${esc(makerName(x))}</small></span><span class="cert">#${m[x].cert}</span><span class="mk"></span></li>`).join("");
    $("#ms-foot").textContent = "Marking";
    await wait(sealed ? 1200 : 1700);
    const rows = $$("#ms-list li");
    for (const [i, x] of shown.entries()) {
      const s2 = m[x].r ? "right" : "wrong";
      rows[i].className = s2;
      rows[i].querySelector(".mk").className = `mk ${s2}`;
      rows[i].querySelector(".mk").innerHTML = ICON[s2];
      await wait(380);
    }
    const right = shown.filter((x) => m[x].r).length;
    $("#ms-foot").textContent = `${right} of ${shown.length} got it right. Each mark is a certificate on NEAR; the last one is in block ${Math.max(...shown.map((x) => m[x].block)).toLocaleString()}.`;
    await wait(3600);
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
  if (n === 1) cycleModels();
}
// On a phone the stage is pinned over the top half, so steps count once they reach the lower part.
const narrow = matchMedia("(max-width: 1000px)").matches;
const stepIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setStep(+e.target.dataset.step); }), { rootMargin: narrow ? "-78% 0px -18% 0px" : "-45% 0px -45% 0px" });
steps.forEach((li) => stepIO.observe(li));


let cycling = 0;
async function cycleModels() {
  const my = ++cycling, names = D ? [...new Set(D.certs.map((c) => modelName(c.model)))] : ["Qwen 3.8"];
  for (let i = 0; my === cycling && current === 1; i++) {
    $("#sit-model").outerHTML = `<span id="sit-model">${esc(names[i % names.length])}</span>`;
    await wait(1400);
  }
}
function fillStageData() {
  $("#seal-build").textContent = short(D.config.grader_version, 6);
  const g = groupsOf(D)[0];
  if (g) {
    const qs = g.qs.slice(0, 12);
    $("#marks").innerHTML = qs.map((q, i) => { const ch = g.byQ.get(q).results[0], s = ch === "1" ? "right" : ch === "0" ? "wrong" : "none"; return `<span class="${s}"><span class="mk ${s}" style="--i:${i}">${ICON[s]}</span></span>`; }).join("");
    const last = g.byQ.get(qs[qs.length - 1]);
    $("#cert-card").innerHTML = `<b>Certificate #${last.id}</b><span>${esc(modelName(g.model))}, block ${last.block_height.toLocaleString()}. Writer paid ${near(last.paid_to_authors)} NEAR.</span>`;
  }
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
  const ms = D.models.filter((m) => m.sealedN > 0 || m.pubN > 0);
  $("#tally").textContent = `${D.certs.length.toLocaleString()} answers on NEAR from ${ms.length} AI models by ${new Set(ms.map((m) => makerName(m.model))).size} makers. The grey bar is the score on questions that have been online for years. The dark bars are the scores on sealed questions nobody had seen.`;
  const pct = (x) => Math.round(100 * x);
  $("#board").innerHTML = ms.map((m, i) => {
    let verdict = "";
    if (m.gap) {
      const p = (x) => `${x > 0 ? "+" : ""}${(100 * x).toFixed(1)}`;
      verdict = m.gap.lo > 0
        ? `<p class="verdict"><strong>Looks like memorising.</strong> ${p(m.gap.mean)} points better on questions it could have seen online.</p>`
        : `<p class="verdict"><strong>No sign of memorising.</strong> Within ${Math.abs(100 * m.gap.mean).toFixed(1)} points of its score on questions it could have seen.</p>`;
    }
    const head = m.sealedN ? m.sealedScore : m.pub;
    const bar = (cls, label, v, n) => n ? `<div class="bar ${cls}"><span>${label}</span><i style="--v:${pct(v)}%"></i><b>${pct(v)}%</b></div>` : "";
    return `<article class="model" style="--i:${i}">
      <span class="rank">${i + 1}</span>
      <div><h3>${esc(modelName(m.model))}</h3><p class="maker">${esc(makerName(m.model))}</p>
        <span class="host ${m.sealed ? "" : "open"}">${m.sealed ? "Sat the exam in secure hardware" : `${esc(makerName(m.model))} saw the questions`}</span></div>
      <div class="duo">
        ${bar("", "Online for years", m.pub, m.pubN)}
        ${bar("fresh", "Sealed school maths", m.fresh, m.freshN)}
        ${bar("hard", "Sealed harder maths", m.hard, m.hardN)}
        ${verdict}
      </div>
      <div class="big"><b data-n="${pct(head)}">0%</b><small>${m.sealedN ? `on ${m.sealedN} sealed questions` : `on ${m.pubN} published questions`}</small></div>
    </article>`;
  }).join("") || `<p class="sub">No exams recorded yet.</p>`;
  $$("#board .model").forEach((el) => { reveal.observe(el); countUp(el.querySelector(".big b"), +el.querySelector(".big b").dataset.n, { suffix: "%" }); });
  $("#badges").innerHTML = ms.slice(0, 3).map((m, i) => `<img style="--i:${i}" src="/api/badge?model=${encodeURIComponent(m.model)}" alt="${esc(modelName(m.model))} score on sealed exams">`).join("");
}

function renderStats() {
  $("#live-count").textContent = `An exam board for AI. ${D.certs.length.toLocaleString()} answers marked on NEAR so far.`;
  countUp($("#paid"), Number(D.paid / 10n ** 21n) / 1000, { decimals: 3 });
  countUp($("#asked"), D.certs.reduce((a, c) => a + c.asked, 0));
  countUp($("#makers"), new Set(D.certs.map((c) => makerName(c.model))).size);
}

(async () => {
  setStep(0);
  try { D = await load(); } catch (err) {
    $("#live-count").textContent = "Couldn't reach NEAR just now";
    $("#board").innerHTML = `<p class="fail">Couldn't read the contract (${esc(err.message)}). Reload to try again.</p>`;
    return;
  }
  renderStats(); renderTicker(); renderBoard(); fillStageData();
  windowLoop();
})();
