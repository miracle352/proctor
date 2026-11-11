import "@fontsource/big-shoulders-display/latin-900";
import "@fontsource/hanken-grotesk/latin-400";
import "@fontsource/hanken-grotesk/latin-500";
import "@fontsource/hanken-grotesk/latin-600";
import "@fontsource/jetbrains-mono/latin-400";
import "@fontsource/jetbrains-mono/latin-500";
import "./style.css";
import { mountRock } from "./rock.js";
import { CONTRACT, load, short, near } from "./chain.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (k, n) => (n ? Math.round((100 * k) / n) : 0);
const EXPLORER = "https://testnet.nearblocks.io";

const rock = mountRock($("#rock"));
let state = null;

/* page chrome */
const nav = $(".nav"), fissure = $(".fissure");
const onScroll = () => {
  nav.classList.toggle("stuck", scrollY > 40);
  const max = document.documentElement.scrollHeight - innerHeight;
  fissure.style.setProperty("--p", max > 0 ? (scrollY / max).toFixed(4) : 0);
};
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// the core sample lights the layer for whichever step is nearest mid-screen
const steps = [...document.querySelectorAll("#steps li")];
const layers = [...document.querySelectorAll("#core i")];
const stepWatch = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const s = e.target.dataset.s;
    steps.forEach((li) => li.classList.toggle("on", li.dataset.s === s));
    layers.forEach((l) => l.classList.toggle("on", +l.dataset.s <= +s));
  }
}, { rootMargin: "-45% 0px -45% 0px" });
steps.forEach((li) => stepWatch.observe(li));

// the limestone headline inks in word by word as it crosses the screen
const whyH = $(".why h2");
whyH.innerHTML = whyH.textContent.split(" ").map((w) => `<span>${w}</span>`).join(" ");
const whyWords = [...whyH.children];
const inkWords = () => {
  const r = whyH.getBoundingClientRect();
  const k = (innerHeight * 0.85 - r.top) / (innerHeight * 0.55);
  whyWords.forEach((w, i) => w.style.setProperty("--ink", Math.max(0, Math.min(1, k * whyWords.length - i)).toFixed(2)));
};
addEventListener("scroll", inkWords, { passive: true });
inkWords();

const reveal = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); }
}, { threshold: 0.25 });

// numbers count up once when they first get real data
function count(el, to, fmt = (v) => Math.round(v).toLocaleString()) {
  const t0 = performance.now(), dur = 1100;
  const tick = (now) => {
    const k = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(to * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// hashes settle from noise into place when you point at them
function scramble(el) {
  const final = el.dataset.full || el.textContent, chars = "0123456789abcdef";
  let f = 0;
  const id = setInterval(() => {
    el.textContent = [...final].map((c, i) => (i < f || c === "…" ? c : chars[(Math.random() * 16) | 0])).join("");
    if ((f += 2) > final.length) { el.textContent = final; clearInterval(id); }
  }, 22);
}

const MARK = { 1: ["r", "right"], 0: ["w", "wrong"], x: ["f", "no answer"], "-": ["", "not asked yet"] };
const tiles = (marks, big) => `<div class="tiles">${[...marks].map((ch, i) =>
  `<i class="${MARK[ch][0]}" style="--i:${i}" ${big ? `title="Question ${i + 1}: ${MARK[ch][1]}"` : ""}></i>`).join("")}</div>`;

function render(d) {
  // hero numbers
  const stat = (k) => $(`#stats [data-k="${k}"]`);
  count(stat("certs"), d.certs.length);
  count(stat("sets"), Object.keys(d.sets).length);
  count(stat("paid"), d.paid, (v) => `${v.toFixed(3)} NEAR`);
  stat("grader").textContent = short(d.config.grader_version, 8);

  // ticker
  const row = d.certs.slice(0, 28).map((c) =>
    `<span><i class="${c.sealed ? "" : "x"}"></i><b>${esc(c.model)}</b>${esc(c.set_id)} #${c.start} ${c.correct}/${c.asked} block ${c.block_height.toLocaleString()}</span>`).join("");
  $("#ticker").innerHTML = row + row;

  // leaderboard
  $("#board").innerHTML = d.models.length ? d.models.map((m) => {
    const head = m.twinScore !== null ? Math.round(m.twinScore * 100) : pct(m.correct, m.asked);
    return `<article class="model">
      <div class="model-name">${esc(m.model.split("/").pop())}
        <small>${esc(m.model)}</small>
        <span class="tag ${m.sealed ? "sealed" : "exposed"}">${m.sealed ? "Ran in attested hardware" : "Host could read the questions"}</span>
      </div>
      <div class="bars">${m.perSet.map((s) => `
        <div class="bar ${s.set_id.includes("-twin-") ? "twin" : ""}">
          <span>${esc(s.set_id)}</span>
          <span class="bar-track"><i class="bar-fill" style="--v:${s.asked ? s.correct / s.asked : 0}"></i></span>
          <b>${s.correct}/${s.asked}</b>
        </div>`).join("")}</div>
      <div class="score">${head}%<small>${m.twinScore !== null ? `on ${m.twinN} unseen questions` : `on ${m.asked} questions`}</small></div>
    </article>`;
  }).join("") : `<p class="loading">No certificates yet for this grader build.</p>`;
  document.querySelectorAll(".model").forEach((el) => reveal.observe(el));

  // contamination gap
  const span = 20; // axis runs from -20 to +20 points
  const pos = (v) => `${50 + Math.max(-span, Math.min(span, v * 100)) / span * 50}%`;
  $("#gap").innerHTML = d.models.filter((m) => m.gap).map((m) => {
    const g = m.gap, sign = g.mean >= 0 ? "+" : "−";
    const clear = g.lo > 0;
    return `<div class="gap-card">
      <div>
        <h3>${esc(m.model.split("/").pop())}: seen versus unseen</h3>
        <div class="gap-num">${sign}${Math.abs(g.mean * 100).toFixed(1)} pts</div>
        <p>Score on ${g.n} public questions minus score on ${g.n} sealed twins of the same questions, with fresh names and numbers of the same size. ${clear
          ? "The whole range sits above zero, so this model does better on questions it could have memorised."
          : "The range touches zero, so on this set there is no sign the model is leaning on memorised answers."}</p>
      </div>
      <div class="axis" role="img" aria-label="Gap ${(g.mean * 100).toFixed(1)} points, 90% range ${(g.lo * 100).toFixed(1)} to ${(g.hi * 100).toFixed(1)}">
        <i class="zero"></i>
        <i class="range" style="left:${pos(g.lo)};width:calc(${pos(g.hi)} - ${pos(g.lo)})"></i>
        <i class="dot" style="left:${pos(g.mean)}"></i>
        <span style="left:0%;transform:none">−${span}</span><span style="left:50%">0</span><span style="left:100%;transform:translateX(-100%)">+${span}</span>
      </div>
    </div>`;
  }).join("");

  // sets
  $("#ledger").innerHTML = Object.entries(d.sets).map(([id, s]) => `
    <div class="set">
      <div class="set-id">${esc(id)}<small>${s.size} questions, ${s.authors.length} writer${s.authors.length > 1 ? "s" : ""}, ${near(s.stake)} NEAR staked</small></div>
      <div class="hashcell" data-full="${esc(s.sha256)}" title="Fingerprint committed on chain">${esc(s.sha256)}</div>
      <div class="wear">${s.revealed ? "Revealed, open to challenge" : `${s.runs} of ${s.retire_after} runs used`}
        <div class="wear-track"><i style="--v:${Math.min(100, (100 * s.runs) / s.retire_after)}%"></i></div></div>
      <div class="seen">${s.exposed_to.length
        ? s.exposed_to.map((p) => `<span class="tag exposed">Seen by ${esc(p)}</span>`).join("")
        : `<span class="tag sealed">Unseen</span>`}${s.faulty.length ? `<span class="tag exposed">${s.faulty.length} faulty</span>` : ""}</div>
    </div>`).join("");
  document.querySelectorAll(".hashcell").forEach((el) => el.addEventListener("pointerenter", () => scramble(el)));

  // certificates, grouped into one tablet per model and set
  const groups = new Map();
  for (const c of d.certs) {
    const key = `${c.model}|${c.set_id}`;
    if (!groups.has(key)) groups.set(key, { key, model: c.model, set_id: c.set_id, sealed: c.sealed, certs: [], marks: {} });
    const g = groups.get(key);
    g.certs.push(c);
    [...c.results].forEach((ch, i) => { if (!(c.start + i in g.marks)) g.marks[c.start + i] = ch; });
  }
  d.groups = [...groups.values()];
  $("#certs").innerHTML = d.groups.map((g) => {
    const size = d.sets[g.set_id]?.size || 0;
    const marks = Array.from({ length: size }, (_, i) => g.marks[i] ?? "-").join("");
    const right = [...marks].filter((m) => m === "1").length, asked = [...marks].filter((m) => m !== "-").length;
    g.marksStr = marks; g.right = right; g.asked = asked;
    const blocks = g.certs.map((c) => c.block_height);
    return `<button class="cert ${g.sealed ? "" : "x"}" data-key="${esc(g.key)}">
      <span class="cert-top"><span>${g.certs.length} certificate${g.certs.length > 1 ? "s" : ""}</span><span>blocks ${Math.min(...blocks).toLocaleString()}–${String(Math.max(...blocks)).slice(-4)}</span></span>
      <span class="cert-model">${esc(g.model.split("/").pop())}</span>
      <span class="cert-meta">${esc(g.set_id)}</span>
      ${tiles(marks)}
      <span class="cert-score">${right}<small>of ${asked} right${asked < size ? `, ${size - asked} not yet asked` : ""}</small></span>
    </button>`;
  }).join("");
}

/* certificate drawer */
const drawer = $("#drawer");
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".cert");
  if (btn && state) openGroup(state.groups.find((g) => g.key === btn.dataset.key));
  if (e.target === drawer || e.target.closest(".dw-close")) drawer.close();
});
function openGroup(g) {
  const set = state.sets[g.set_id];
  const rows = g.certs.slice().sort((a, b) => a.start - b.start).map((c) => `
    <tr><td>#${c.id}</td><td>Q${c.start + 1}${c.asked > 1 ? `–${c.start + c.asked}` : ""}</td>
    <td>${c.correct}/${c.asked}</td>
    <td><a href="${EXPLORER}/blocks/${c.block_height}" target="_blank" rel="noopener">${c.block_height.toLocaleString()}</a></td>
    <td class="mono">${c.chat_ids.map((id) => esc(short(id, 5))).join(" ") || "none"}</td></tr>`).join("");
  drawer.innerHTML = `<div class="dw">
    <button class="dw-close">Close</button>
    <div><p class="dw-note">${esc(g.set_id)}</p><h2 id="drawer-title">${esc(g.model)}</h2></div>
    <div class="dw-score">${g.right}/${g.asked}<small>questions right</small></div>
    ${tiles(g.marksStr, true)}
    <p class="dw-note">${g.sealed
      ? "This model ran inside attested hardware on NEAR AI Cloud, so nobody outside it saw the questions."
      : `This model is hosted outside attested hardware. Its host could read the questions, so the set is now marked as seen by ${esc(g.model.split("/")[0])}.`}</p>
    <dl>
      <dt>Set fingerprint</dt><dd class="mono">${esc(set.sha256)}</dd>
      <dt>Matches commitment</dt><dd>${g.certs.every((c) => c.set_sha256 === set.sha256) ? "Yes, the contract checked every certificate before storing it" : "No"}</dd>
      <dt>Grader build</dt><dd class="mono">${esc(g.certs[0].grader_version)}</dd>
      <dt>Paid to writers</dt><dd>${near(g.certs.reduce((a, c) => a + BigInt(c.paid_to_authors), 0n).toString())} NEAR</dd>
    </dl>
    <table class="dw-table">
      <thead><tr><th>Certificate</th><th>Question</th><th>Right</th><th>Block</th><th>Model receipt</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="dw-note">A receipt is the chat id NEAR AI Cloud signed inside its hardware. Its signature can be fetched from NEAR AI at /v1/signature/ followed by the full id.</p>
  </div>`;
  drawer.showModal();
}

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
    <a class="btn dark" href="${url}" download="${esc(set_id)}.json">Download ${esc(set_id)}.json</a>
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
    rock.pulse();
  } else {
    out.className = "out bad";
    out.innerHTML = `<strong>No committed set has this fingerprint</strong><span>Even one changed character gives a different fingerprint. Check the file is the original, with no added spaces or line breaks.</span><code>${hash}</code>`;
  }
});

/* data */
const net = $("#net");
async function refresh(first) {
  try {
    const d = await load();
    const fresh = !state || d.certs.length !== state.certs.length;
    state = d;
    if (fresh) { render(d); if (!first) rock.pulse(); }
    net.className = "net live";
    net.querySelector("span").textContent = "Live on NEAR testnet";
  } catch (err) {
    net.className = "net fail";
    net.querySelector("span").textContent = "Can't reach NEAR, retrying";
    if (!state) $("#board").innerHTML = `<p class="loading">Couldn't read the contract (${esc(err.message)}). Retrying every 20 seconds.</p>`;
  }
}
refresh(true).then(() => rock.pulse());
setInterval(() => { if (!document.hidden) refresh(false); }, 20000);
