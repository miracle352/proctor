import "@fontsource/bricolage-grotesque/latin-600.css";
import "@fontsource/bricolage-grotesque/latin-700.css";
import "@fontsource/bricolage-grotesque/latin-800.css";
import "@fontsource/hanken-grotesk/latin-400.css";
import "@fontsource/hanken-grotesk/latin-500.css";
import "@fontsource/hanken-grotesk/latin-600.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "./style.css";
import { CONTRACT, load, short, near } from "./chain.js";
import { mountBust } from "./bust.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const EXPLORER = "https://testnet.nearblocks.io";
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, still ? 0 : ms));
let state = null;

mountBust($("#bust"), "/socrates.png").catch(() => $(".bust").remove());

/* names a visitor can read */
const modelName = (m) => m.split("/").pop();
const maker = (m) => m.split("/")[0].replace(/^[a-z]/, (c) => c.toUpperCase());
function setLabel(id) {
  const part = id.split("-").pop().toUpperCase();
  if (id.includes("-original-")) return `Published maths questions, part ${part}`;
  if (id.includes("-twin-")) return `Rewritten maths questions, part ${part}`;
  return id;
}
const ICON = {
  right: '<svg viewBox="0 0 24 24"><path d="M5 12.5l5 5.5 9-11"/></svg>',
  wrong: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  none: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
};

/* page chrome */
const nav = $(".nav");
const whyH = $(".why h2");
whyH.innerHTML = whyH.textContent.split(" ").map((w) => `<span class="w">${w}</span>`).join(" ");
const words = [...whyH.children];
function onScroll() {
  nav.classList.toggle("stuck", scrollY > 8);
  const r = whyH.getBoundingClientRect();
  const k = (innerHeight * 0.88 - r.top) / (innerHeight * 0.5);
  words.forEach((w, i) => w.style.setProperty("--k", Math.max(0, Math.min(1, k * words.length - i)).toFixed(2)));
}
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const seen = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add("on"); seen.unobserve(e.target); }
}), { threshold: 0.45 });
document.querySelectorAll(".steps li").forEach((li) => seen.observe(li));

/* the exam room */
const picker = $("#picker"), sheet = $("#sheet"), result = $("#result"), track = [...$("#track").children];
const proof = document.createElement("div");
proof.className = "proof"; proof.id = "proof"; proof.hidden = true;
$(".room-body").after(proof);
let current = null, token = 0, roomInView = false, played = false;

function buildGroups(d) {
  const map = new Map();
  for (const c of d.certs) {
    const key = `${c.model}|${c.set_id}`;
    if (!map.has(key)) map.set(key, { key, model: c.model, set_id: c.set_id, sealed: c.sealed, certs: [], marks: {} });
    const g = map.get(key);
    g.certs.push(c);
    [...c.results].forEach((ch, i) => { if (!(c.start + i in g.marks)) g.marks[c.start + i] = ch; });
  }
  const rank = (g) => (g.sealed ? 0 : 2) + (g.set_id.includes("-twin-") ? 0 : 1);
  return [...map.values()].map((g) => {
    const size = d.sets[g.set_id]?.size || 0;
    g.list = Array.from({ length: size }, (_, i) => g.marks[i] ?? "-");
    g.right = g.list.filter((m) => m === "1").length;
    g.asked = g.list.filter((m) => m !== "-").length;
    return g;
  }).sort((a, b) => rank(a) - rank(b) || a.set_id.localeCompare(b.set_id));
}

function renderPicker(groups) {
  picker.innerHTML = groups.map((g) =>
    `<button role="tab" data-key="${esc(g.key)}" aria-selected="${current?.key === g.key}"><b>${esc(modelName(g.model))}</b>${esc(setLabel(g.set_id))}</button>`).join("");
}
picker.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && state) run(state.groups.find((g) => g.key === b.dataset.key));
});

// widths for the blacked-out question text, steady for a given question
const inkWidth = (key, i) => { let h = 2166136261; for (const ch of key + i) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); h ^= h >>> 13; return 42 + ((h >>> 0) % 56); };

async function run(g) {
  const my = ++token, live = () => my === token;
  current = g; played = true;
  renderPicker(state.groups);
  proof.hidden = true;
  const set = state.sets[g.set_id], blocks = g.certs.map((c) => c.block_height);
  const lo = Math.min(...blocks), hi = Math.max(...blocks);

  sheet.innerHTML = `
    <div class="sheet-top"><strong>${esc(setLabel(g.set_id))}</strong><span>${g.list.length} questions, each with one exact answer</span></div>
    <div class="rows" style="--n:${Math.ceil(g.list.length / 2)}">${g.list.map((m, i) =>
      `<div class="row" data-s="${m === "-" ? "skip" : "wait"}"><span class="qn">Q${i + 1}</span><span class="ink" style="--w:${inkWidth(g.key, i)}%"></span><span class="mk"></span></div>`).join("")}</div>
    <p class="sheet-foot">The question text is blacked out here because it is still sealed. It is published once this set retires.</p>`;
  result.innerHTML = `
    <h3><b>${esc(modelName(g.model))}</b>sitting ${esc(setLabel(g.set_id)).replace(/^./, (c) => c.toLowerCase())}</h3>
    <div class="score"><span id="sc">0</span><small>of ${g.asked} right</small></div>
    <p>${g.sealed
      ? "This AI also ran inside secure hardware, so nobody saw the questions at any point."
      : `This AI runs on ${esc(maker(g.model))}'s own servers, so ${esc(maker(g.model))} could have read the questions. Proctor has marked this set as seen by ${esc(maker(g.model))}.`}</p>
    <div class="slip" id="slip"><strong>Recorded on NEAR</strong>
      <span>${g.certs.length} certificate${g.certs.length > 1 ? "s" : ""}, written between blocks ${lo.toLocaleString()} and ${hi.toLocaleString()}.</span>
      <a href="${EXPLORER}/blocks/${hi}" target="_blank" rel="noopener">Open block ${hi.toLocaleString()} on the public record</a></div>
    <div class="result-actions"><button class="link-btn" id="again">Play it again</button><button class="link-btn" id="proof-btn" aria-expanded="false" aria-controls="proof">Show the proof</button></div>`;
  $("#again").onclick = () => run(g);
  $("#proof-btn").onclick = (e) => {
    proof.hidden = !proof.hidden;
    e.target.setAttribute("aria-expanded", !proof.hidden);
    e.target.textContent = proof.hidden ? "Show the proof" : "Hide the proof";
    if (!proof.hidden) proof.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  proof.innerHTML = `<dl>
      <dt>Set fingerprint</dt><dd class="mono">${esc(set.sha256)}</dd>
      <dt>Fingerprint check</dt><dd>${g.certs.every((c) => c.set_sha256 === set.sha256) ? "The contract checked every certificate against this fingerprint before storing it" : "Mismatch"}</dd>
      <dt>Marking program</dt><dd class="mono">${esc(g.certs[0].grader_version)}</dd>
      <dt>Paid to writers</dt><dd>${near(g.certs.reduce((a, c) => a + BigInt(c.paid_to_authors), 0n).toString())} NEAR</dd>
    </dl>
    <table><thead><tr><th>Certificate</th><th>Question</th><th>Right</th><th>Block</th><th>AI's signed receipt</th></tr></thead><tbody>${
      g.certs.slice().sort((a, b) => a.start - b.start).map((c) => `<tr><td>#${c.id}</td><td>Q${c.start + 1}${c.asked > 1 ? `–${c.start + c.asked}` : ""}</td><td>${c.correct}/${c.asked}</td>
        <td><a href="${EXPLORER}/blocks/${c.block_height}" target="_blank" rel="noopener">${c.block_height.toLocaleString()}</a></td>
        <td class="mono">${c.chat_ids.map((id) => esc(short(id, 6))).join(" ") || "none"}</td></tr>`).join("")}</tbody></table>
    <p class="proof-note">A receipt is the id of the conversation, signed by NEAR AI Cloud inside its hardware. The signature can be fetched from NEAR AI at /v1/signature/ followed by the full id.</p>`;

  const rows = [...sheet.querySelectorAll('.row:not([data-s="skip"])')], marks = g.list.filter((m) => m !== "-");
  const stage = (i, dur) => track.forEach((li, j) => { li.style.setProperty("--dur", `${dur}ms`); li.className = j < i ? "done" : j === i ? "now" : ""; });

  stage(0, 900); await wait(900); if (!live()) return;
  const askFor = Math.min(2200, 500 + rows.length * 90);
  stage(1, askFor);
  rows.forEach((r, i) => setTimeout(() => live() && r.dataset.s === "wait" && (r.dataset.s = "ask"), still ? 0 : (i * (askFor - 400)) / rows.length));
  await wait(askFor); if (!live()) return;
  const per = Math.max(70, Math.min(170, 2400 / rows.length));
  stage(2, per * rows.length);
  let right = 0;
  for (const [i, r] of rows.entries()) {
    const m = marks[i], s = m === "1" ? "right" : m === "0" ? "wrong" : "none";
    r.dataset.s = s; r.querySelector(".mk").innerHTML = ICON[s];
    if (m === "1") $("#sc").textContent = ++right;
    await wait(per); if (!live()) return;
  }
  stage(3, 700); await wait(250); if (!live()) return;
  $("#slip").classList.add("in");
  await wait(700); if (!live()) return;
  stage(4, 0);
}

new IntersectionObserver(([e]) => {
  roomInView = e.isIntersecting;
  if (roomInView && state && !played) run(state.groups[0]);
}, { threshold: 0.3 }).observe($(".room"));

/* scores */
function renderBoard(d) {
  $("#tally").textContent = `${d.certs.length} certificates on the record across ${Object.keys(d.sets).length} question sets. ${d.paid.toLocaleString(undefined, { maximumFractionDigits: 3 })} NEAR paid to question writers so far.`;
  const pct = (a, b) => Math.round((100 * a) / b);
  $("#board").innerHTML = d.models.map((m) => {
    const of = (tag) => m.perSet.filter((s) => s.set_id.includes(tag)).reduce((a, s) => [a[0] + s.correct, a[1] + s.asked], [0, 0]);
    const pub = of("-original-"), fresh = of("-twin-");
    let verdict = "";
    if (m.gap) {
      const p = (x) => `${x > 0 ? "+" : ""}${(100 * x).toFixed(1)}`;
      verdict = m.gap.lo <= 0
        ? `<strong>No sign of memorising</strong><span>It scored ${pct(...pub)}% on the published questions and ${pct(...fresh)}% on rewritten versions it could not have seen. That is a difference of ${p(m.gap.mean)} points, and with ${m.gap.n} pairs the true figure could be anywhere from ${p(m.gap.lo)} to ${p(m.gap.hi)}.</span>`
        : `<strong>Looks like memorising</strong><span>It scored ${pct(...pub)}% on the published questions but ${pct(...fresh)}% on rewritten versions, a drop of ${p(m.gap.mean)} points (between ${p(m.gap.lo)} and ${p(m.gap.hi)}).</span>`;
    } else if (!m.sealed) {
      verdict = `<strong>Treat with care</strong><span>${esc(maker(m.model))} could read these questions while answering, so the same set can't fairly be used on its models again.</span>`;
    }
    const head = m.twinN ? [pct(...fresh), `on ${m.twinN} questions it had never seen`] : [pct(m.correct, m.asked), `on ${m.asked} question${m.asked > 1 ? "s" : ""}`];
    return `<article class="model">
      <div><h3>${esc(modelName(m.model))}</h3>
        <p class="host ${m.sealed ? "" : "open"}">${m.sealed ? "Ran inside secure hardware. Nobody saw the questions." : `Runs on ${esc(maker(m.model))}'s servers, which could read the questions.`}</p></div>
      <div class="bars">${m.perSet.map((s) => `<div class="bar ${s.set_id.includes("-twin-") ? "fresh" : ""}"><span>${esc(setLabel(s.set_id))}</span><i style="--v:${(100 * s.correct) / s.asked}%"></i><b>${s.correct}/${s.asked}</b></div>`).join("")}</div>
      <div class="total">${head[0]}%<small>${head[1]}</small></div>
      ${verdict ? `<div class="verdict">${verdict}</div>` : ""}
    </article>`;
  }).join("") || `<p class="sub">No exams have been recorded yet.</p>`;

  $("#sets tbody").innerHTML = Object.entries(d.sets).map(([id, s]) => `<tr>
    <td>${esc(setLabel(id))}${setLabel(id) !== id ? `<small>${esc(id)}</small>` : ""}</td>
    <td>${s.size}</td>
    <td>${s.revealed ? "Published, open to challenge" : `${s.runs} of ${s.retire_after} runs`}</td>
    <td>${s.exposed_to.length ? `<span class="status seen">Seen by ${s.exposed_to.map(esc).join(", ")}</span>` : `<span class="status">Unseen</span>`}</td>
    <td><button class="copy" data-full="${esc(s.sha256)}" title="Copy the full fingerprint">${esc(short(s.sha256, 8))}</button></td></tr>`).join("");
}
$("#sets").addEventListener("click", async (e) => {
  const b = e.target.closest(".copy");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.full); } catch { return; }
  const was = b.textContent;
  b.textContent = "Copied"; b.classList.add("done");
  setTimeout(() => { b.textContent = was; b.classList.remove("done"); }, 1300);
});

/* write questions */
const qs = $("#qs");
function addQuestion() {
  const n = qs.children.length + 1;
  const div = document.createElement("div");
  div.className = "q";
  div.innerHTML = `
    <label>Question ${n}<textarea name="prompt" rows="3" required placeholder="A problem with one exact answer"></textarea></label>
    <div class="q-row">
      <label>Answer is<select name="kind"><option value="number">a number</option><option value="exact">exact text</option></select></label>
      <label>Correct answer<input name="value" required></label>
      <label>Allowed error<input name="tol" inputmode="decimal" value="0"></label>
      <button type="button" class="q-del">Remove</button>
    </div>`;
  div.querySelector("select").addEventListener("change", (e) => {
    div.querySelector('[name="tol"]').disabled = e.target.value === "exact";
  });
  div.querySelector(".q-del").addEventListener("click", () => { if (qs.children.length > 1) div.remove(); });
  qs.append(div);
}
$("#add-q").addEventListener("click", addQuestion);
addQuestion();

const sha256 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

$("#seal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), out = $("#seal-out");
  const set_id = f.get("set_id").trim(), author = f.get("author").trim();
  const items = [];
  for (const [i, q] of [...qs.children].entries()) {
    const kind = q.querySelector('[name="kind"]').value, raw = q.querySelector('[name="value"]').value.trim();
    let answer;
    if (kind === "number") {
      const value = Number(raw.replace(/,/g, "")), tol = Number(q.querySelector('[name="tol"]').value || 0);
      if (!Number.isFinite(value) || !Number.isFinite(tol) || tol < 0) {
        out.hidden = false; out.className = "out bad";
        out.innerHTML = `<strong>Question ${i + 1} needs a number</strong><span>"${esc(raw)}" isn't a number. Enter digits only, or switch the answer type to exact text.</span>`;
        return;
      }
      answer = { kind, value, tol };
    } else answer = { kind, value: raw };
    items.push({ id: `q${i + 1}`, author, prompt: q.querySelector('[name="prompt"]').value.trim(), answer });
  }
  // Same bytes the grader will hash: compact JSON, keys in this order.
  const text = JSON.stringify({ set_id, items });
  const hash = await sha256(text);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  out.hidden = false; out.className = "out ok";
  out.innerHTML = `<strong>Sealed file built</strong>
    <span>${items.length} question${items.length > 1 ? "s" : ""}. Keep the file private until the set is retired. Its fingerprint is what goes on chain:</span>
    <code>${hash}</code>
    <a class="btn primary" href="${url}" download="${esc(set_id)}.json">Download ${esc(set_id)}.json</a>
    <span>Lock it to the grader build, then commit the fingerprint:</span>
    <pre>outlayer secrets set "$(python3 -c 'import json,sys;print(json.dumps({"PROCTOR_SET":open(sys.argv[1]).read()}))' ${esc(set_id)}.json)" \\
  --project proctor-91796.testnet/grader --profile ${esc(set_id)} --access allow-all \\
  --build ${state ? state.config.grader_version : "GRADER_BUILD"}

near contract call-function as-transaction ${CONTRACT} commit_set json-args \\
  '{"set_id":"${esc(set_id)}","sha256":"${hash}","size":${items.length},"authors":["${esc(author)}"],"price_per_question":"1000000000000000000000","retire_after":40}' \\
  prepaid-gas '30 Tgas' attached-deposit '0.2 NEAR' sign-as ${esc(author)} network-config testnet sign-with-keychain send</pre>`;
  out.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

/* verify */
$("#verify-btn").addEventListener("click", async () => {
  const text = $("#verify-in").value, out = $("#verify-out");
  out.hidden = false;
  if (!text.trim()) { out.className = "out bad"; out.innerHTML = `<strong>Nothing to check</strong><span>Paste the published set file, exactly as it was released.</span>`; return; }
  const hash = await sha256(text);
  const hit = state && Object.entries(state.sets).find(([, s]) => s.sha256 === hash);
  if (hit) {
    out.className = "out ok";
    out.innerHTML = `<strong>Matches ${esc(hit[0])}</strong><span>These are the exact bytes committed on chain before the set was used in ${hit[1].runs} run${hit[1].runs === 1 ? "" : "s"}.</span><code>${hash}</code>`;
  } else {
    out.className = "out bad";
    out.innerHTML = `<strong>No committed set has this fingerprint</strong><span>Even one changed character gives a different fingerprint. Check the file is the original, with no added spaces or line breaks.</span><code>${hash}</code>`;
  }
});

/* data */
async function refresh() {
  try {
    const d = await load();
    const fresh = !state || d.certs.length !== state.certs.length;
    d.groups = buildGroups(d);
    state = d;
    if (!fresh) return;
    renderBoard(d);
    if (!current) {
      renderPicker(d.groups);
      if (!d.groups.length) { sheet.innerHTML = `<p class="sub">No exams have been recorded yet.</p>`; result.innerHTML = ""; }
      else if (roomInView) run(d.groups[0]);
    } else renderPicker(d.groups);
  } catch (err) {
    if (state) return;
    const msg = `<p class="fail">Couldn't reach NEAR to read the record (${esc(err.message)}). Trying again every 20 seconds.</p>`;
    result.innerHTML = msg; $("#board").innerHTML = msg; $("#tally").textContent = "";
  }
}
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 20000);
