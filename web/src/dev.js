import "./fonts.js";
import "./base.css";
import "./app.css";
import { load, balance, view, modelName, makerName, setLabel, near, esc, $, $$, LOGO, ICON, EXPLORER } from "./chain.js";

$("#logo").innerHTML = LOGO;
const SITE = "https://useproctor.vercel.app";
const ATTESTED = new Set(["Qwen/Qwen3.8-27B"]);
let D = null, me = null, W = null;
const wallet = () => (W ||= import("./wallet.js"));
const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.className = "toast"; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3000); };

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  try { await navigator.clipboard.writeText($("#" + b.dataset.copy).textContent); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1400); } catch { toast("Couldn't copy. Select the text instead."); }
});
$$(".tabs button").forEach((b) => b.addEventListener("click", () => {
  $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
  $("#code-cli").hidden = b.dataset.tab !== "cli"; $("#code-js").hidden = b.dataset.tab !== "js";
}));

/* badge builder */
function renderBadge() {
  const m = $("#b-model").value;
  const img = `${SITE}/api/badge?model=${encodeURIComponent(m)}`, link = `${SITE}/#scores`;
  $("#b-preview").innerHTML = `<img src="/api/badge?model=${encodeURIComponent(m)}" alt="${esc(modelName(m))} score on sealed exams" height="30">`;
  $("#b-md").textContent = `[![${modelName(m)} on Proctor sealed exams](${img})](${link})`;
  $("#b-html").textContent = `<a href="${link}"><img src="${img}" alt="${modelName(m)} on Proctor sealed exams" height="30"></a>`;
}
$("#b-model").addEventListener("change", renderBadge);

/* scores as data */
async function liveJson() {
  try {
    const r = await fetch("/api/scores");
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    j.models = j.models.slice(0, 2);
    $("#d-res").textContent = JSON.stringify(j, null, 2).split("\n").slice(0, 40).join("\n") + "\n  …";
    $("#d-when").textContent = "first two models shown";
  } catch {
    $("#d-res").textContent = "The JSON endpoint runs on the deployed site. Open https://useproctor.vercel.app/api/scores to see it.";
  }
}

/* tables */
function renderTables() {
  $("#models-table tbody").innerHTML = Object.entries(D.publicModels).map(([m, info]) =>
    `<tr><td><code>${esc(m)}</code></td><td>${ATTESTED.has(m) ? "Nobody: it runs in secure hardware" : `${esc(makerName(m))}, so the set is marked as seen`}</td><td>${near(info.ai_fee)} NEAR</td></tr>`).join("");
  $("#sets-table tbody").innerHTML = Object.entries(D.sets).filter(([, s]) => !s.revealed && s.runs < s.retire_after * s.size).map(([id, s]) =>
    `<tr><td><code>${esc(id)}</code><small>${esc(setLabel(id))}</small></td><td>${s.size}</td><td>${near(s.price_per_question)} NEAR</td><td>${s.exposed_to.length ? s.exposed_to.map((p) => esc(makerName(p + "/"))).join(", ") : "Nobody yet"}</td></tr>`).join("");
}

/* console */
async function renderConsole() {
  const body = $("#console-body");
  if (!me) {
    $("#console-who").textContent = "Not connected";
    body.innerHTML = `<p class="hint">Connect a NEAR testnet wallet to see the exams you've run, the question sets you've written and what they've earned.</p><button class="btn primary" type="button" id="console-connect"><span class="dot"></span>Connect wallet</button>`;
    $("#console-connect").onclick = async () => (await wallet()).connect();
    return;
  }
  $("#console-who").textContent = me;
  const mine = D.every.filter((c) => c.requester === me).sort((a, b) => b.id - a.id);
  const right = mine.reduce((a, c) => a + c.correct, 0), asked = mine.reduce((a, c) => a + c.asked, 0);
  const sets = Object.entries(D.sets).filter(([, s]) => s.authors.includes(me) || s.keeper === me);
  const earned = D.every.filter((c) => D.sets[c.set_id]?.authors.includes(me)).reduce((a, c) => a + BigInt(c.paid_to_authors) / BigInt(D.sets[c.set_id].authors.length), 0n);
  let allowance = null, bal = null;
  try { allowance = await view("allowance", { account_id: me }); } catch {}
  try { bal = await balance(me); } catch {}
  body.innerHTML = `
    <div class="tiles4">
      <div><b>${asked}</b><span>questions you've asked</span></div>
      <div><b>${asked ? Math.round((100 * right) / asked) + "%" : "–"}</b><span>answered right</span></div>
      <div><b>${sets.length}</b><span>sets you wrote</span></div>
      <div><b>${near(earned)}</b><span>NEAR earned as a writer</span></div>
    </div>
    <p class="note">${bal !== null ? `Wallet balance ${near(bal, 2)} NEAR. ` : ""}${allowance ? (allowance.unlimited ? "No daily limit on this account." : `${allowance.account_left} questions left today.`) : ""}</p>
    <h3 class="minor-h">Your recent results</h3>
    ${mine.length ? `<div class="table-scroll"><table class="dev-table"><thead><tr><th>Certificate</th><th>Model</th><th>Set and question</th><th>Mark</th><th>Block</th></tr></thead><tbody>${mine.slice(0, 25).map((c) => {
      const s = c.results[0] === "1" ? "right" : c.results[0] === "0" ? "wrong" : "none";
      return `<tr><td><a href="/app#check?cert=${c.id}">#${c.id}</a></td><td>${esc(modelName(c.model))}</td><td>${esc(setLabel(c.set_id))}, Q${c.start + 1}</td><td><span class="mk ${s}">${ICON[s]}</span></td><td><a href="${EXPLORER}/blocks/${c.block_height}" target="_blank" rel="noopener">${c.block_height.toLocaleString()}</a></td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="hint">No exams yet. <a href="/app#test">Run your first one</a>.</p>`}
    <h3 class="minor-h">Your question sets</h3>
    ${sets.length ? `<div class="table-scroll"><table class="dev-table"><thead><tr><th>Set</th><th>Questions</th><th>Exams used</th><th>Seen by</th></tr></thead><tbody>${sets.map(([id, s]) => `<tr><td><code>${esc(id)}</code></td><td>${s.size}</td><td>${Math.floor(s.runs / s.size)} of ${s.retire_after}</td><td>${s.exposed_to.join(", ") || "Nobody yet"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">You haven't written a set. <a href="/app#write">Write one</a>.</p>`}`;
}

function renderWho() {
  const who = $("#who");
  who.innerHTML = me
    ? `<div class="chip"><span class="avatar">${esc(me[0].toUpperCase())}</span><span><b>${esc(me.length > 22 ? me.slice(0, 10) + "…" + me.slice(-8) : me)}</b><small>testnet</small></span><button class="link" id="disconnect" type="button">Disconnect</button></div>`
    : `<button class="btn primary small" id="connect" type="button"><span class="dot"></span>Connect wallet</button>`;
  if (me) $("#disconnect").onclick = async () => (await wallet()).disconnect();
  else $("#connect").onclick = async () => (await wallet()).connect();
}

(async () => {
  liveJson();
  try { D = await load(); } catch (e) { $("#console-body").innerHTML = `<p class="fail">Couldn't reach NEAR (${esc(e.message)}). Reload to try again.</p>`; return; }
  $("#b-model").innerHTML = D.models.filter((m) => m.sealedN).map((m) => `<option value="${esc(m.model)}">${esc(modelName(m.model))}</option>`).join("");
  renderBadge(); renderTables(); renderConsole(); renderWho();
  $("#lic-badges").innerHTML = D.wallets.map((w) => `<img src="/api/badge?model=${encodeURIComponent(w.model)}&skill=money" alt="${esc(modelName(w.model))} money licence" height="30">`).join(" ");
  try {
    const w = await wallet(); await w.initWallet();
    w.onAccount((a) => { me = a; renderWho(); renderConsole(); });
  } catch (e) { console.error(e); }
})();
