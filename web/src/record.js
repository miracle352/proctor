import "./fonts.js";
import "./base.css";
import "./app.css";
import "./record.css";
import { CONTRACT, EXPLORER, view, modelName, makerName, near, esc, $, $$, LOGO, countUp } from "./chain.js";

$("#logo").innerHTML = LOGO;
const id = new URLSearchParams(location.search).get("model");
const nameOf = (m) => m.startsWith("agent:") ? m.split("/").pop() : modelName(m);
const whoOf = (m) => m.startsWith("agent:") ? `Agent by ${m.slice(6).split("/")[0]}` : makerName(m);
const whose = (e) => e.hunter === "Proctor's drill" ? "a trap in Proctor's drill" : `${esc(e.hunter)}'s trap`;
const link = (m) => `/record?model=${encodeURIComponent(m)}`;

async function record(m) {
  const r = await fetch(`/api/record?model=${encodeURIComponent(m)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Couldn't read the record");
  return j;
}

/* the list: everyone who has sat the exam */
async function list() {
  $("#pick").hidden = false;
  try {
    const [pub, agents] = await Promise.all([view("list_public_models"), view("list_agents")]);
    const ids = [...pub.map(([m]) => m), ...agents.map((a) => a.id)];
    const lic = await Promise.all(ids.map((m) => view("licence", { model: m, skill: "money" }).catch(() => null)));
    const rows = ids.map((m, i) => ({ m, l: lic[i] })).filter((x) => x.l && x.l.asked > 0);
    const state = (l) => l.suspension ? (l.suspension.confirmed ? ["Revoked", "off"] : ["Suspended", "off"]) : l.licensed ? ["Licensed", "on"] : ["Not licensed", "no"];
    $("#rec-list").innerHTML = rows.map(({ m, l }, i) => {
      const [label, cls] = state(l);
      return `<a class="rec-row ${cls}" href="${link(m)}" style="--i:${i}"><div><b>${esc(nameOf(m))}</b><small>${esc(whoOf(m))}</small></div><span class="pill ${cls}">${label}</span><span class="pct">${l.percent}%</span></a>`;
    }).join("");
  } catch (e) { $("#rec-list").innerHTML = `<p class="hint">NEAR testnet isn't answering. Reload in a moment.</p>`; }
}

/* one record */
async function show(m) {
  $("#rec").hidden = false;
  document.title = `${nameOf(m)}: licence record · Proctor`;
  $("#r-name").textContent = nameOf(m);
  $("#r-kind").textContent = m.startsWith("agent:") ? "Agent licence record" : "AI licence record";
  let r;
  try { r = await record(m); } catch (e) { $("#r-sub").textContent = e.message; return; }
  const money = r.licences.money, pro = r.licences["money-pro"], s = money.suspension;
  $("#r-sub").innerHTML = r.agent
    ? `${esc(r.agent.name)}, owned by <b>${esc(r.agent.owner)}</b>. Runs on ${esc(modelName(r.agent.model))}; its instructions are fixed by fingerprint <code>${esc(r.agent.prompt_sha256.slice(0, 12))}…</code>`
    : `${esc(makerName(m))}. ${money.maker_saw_exam ? "Runs on its maker's servers, so the maker could see the questions it was asked." : "Runs in attested secure hardware: nobody saw its exam questions."}`;

  // the stamp, in the one place the page spends its motion
  const [stamp, cls] = s ? [s.confirmed ? "REVOKED" : "SUSPENDED", "off"] : money.licensed ? ["LICENSED", "on"] : ["NOT LICENSED", "no"];
  $("#r-stamp").innerHTML = `<span class="big-stamp ${cls}">${stamp}</span><small>${esc(money.reason)}</small>`;

  const pct = (l) => (l.asked ? `${l.percent}%` : "–");
  $("#n-exam").textContent = pct(money); $("#n-pro").textContent = pct(pro);
  countUp($("#n-refused"), r.traps.refused); countUp($("#n-paid"), r.traps.paid);
  if (r.traps.paid) $("#n-paid").closest("div").classList.add("hot");

  const licRow = (l, title) => `<div class="lic ${l.suspension ? "off" : l.licensed ? "on" : "no"}">
    <div><b>${title}</b><small>${l.asked ? `${l.right} of ${l.asked} right, ${l.percent}%` : "Not sat yet"}${l.licensed && l.expires_ms ? `. Valid until ${new Date(l.expires_ms).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}</small></div>
    <span>${esc(l.reason)}</span>${l.known && l.known.required ? `<small class="known-line">Known scams: passed ${l.known.passed} of ${l.known.required}${l.known.paid ? `, paid ${esc(l.known.paid)}` : ""}${l.known.due.length ? `, ${l.known.due.length} still to sit` : ""}</small>` : ""}</div>`;
  $("#r-licences").innerHTML = licRow(money, "Money licence") + licRow(pro, "Money licence, hard exam");

  const fx = [];
  if (r.budget) fx.push(r.budget.frozen
    ? `<li class="off"><b>Budget frozen.</b> The budgets contract refused its next spend and sent what was left back to its owner.</li>`
    : `<li class="on"><b>Budget live.</b> ${near(r.budget.left)} NEAR left; every spend checks this licence first.</li>`);
  for (const v of r.vault.slice().reverse().slice(0, 4)) fx.push(`<li class="${v.paid ? "on" : "off"}"><b>Vault ${v.paid ? "paid" : "refused"}</b> a bill it asked for. ${esc(v.reason)}.</li>`);
  for (const w of (r.agent_wallets || []).slice(0, 4)) fx.push(w.frozen
    ? `<li class="off"><b>Agent wallet frozen.</b> Its next payment was refused and ${esc(w.owner)} got the rest back. ${esc(w.reason)}.</li>`
    : `<li class="on"><b>Agent wallet live.</b> ${near(w.spent)} NEAR paid so far, ${near(w.left)} NEAR left, locked to one key that can only ask for payments.</li>`);
  if (r.wallet) fx.push(`<li><b>Wallet:</b> ${near(r.wallet.balance)} NEAR left${r.wallet.lost !== "0" ? `, ${near(r.wallet.lost)} NEAR lost to exam scams` : ""}.</li>`);
  $("#r-effects").innerHTML = fx.length ? `<ul class="fx">${fx.join("")}</ul>` : `<p class="hint">No contract has asked about this AI yet.</p>`;

  const ev = r.events.map((e, i) => {
    const what = e.kind === "hunt"
      ? (e.paid > 0 ? `<b>Paid ${whose(e)}.</b>${e.caught ? " Licence suspended." : " It wasn't licensed at the time."}` : e.failed >= e.asked ? `Didn't answer ${whose(e)}.` : `<b>Refused ${whose(e)}.</b>`)
      : e.set.startsWith("known-") ? `Known scam from ${esc(e.set.slice(6).replace(/^g-/, "").split("-")[0])}'s catch: ${e.right === e.asked ? "<b>refused</b>" : "<b>paid it</b>"}.`
      : `${e.kind === "hard exam" ? "Hard exam" : e.kind === "wallet exam" ? "Wallet exam" : "Exam"} part ${esc(e.set.split("-").pop().toUpperCase())}: ${e.right} of ${e.asked} right${e.failed ? `, ${e.failed} unanswered` : ""}.`;
    const cls = e.kind === "hunt" ? (e.paid > 0 ? "paid" : "held") : e.right === e.asked ? "held" : "miss";
    return `<li class="${cls}" style="--i:${Math.min(i, 12)}"><span class="dot"></span><div>${what}<small><a href="/app#check?cert=${e.cert}">Certificate ${e.cert}</a> · <a href="/app#check?cert=${e.cert}&proof">Hardware proof</a></small></div></li>`;
  });
  $("#r-events").innerHTML = ev.join("") || `<li class="hint">Nothing yet.</li>`;

  const code = {
    rust: `// Ask Proctor before your contract lets ${nameOf(m)} move money.
Promise::new("${CONTRACT}".parse().unwrap())
    .function_call("licence".into(),
        json!({ "model": "${m}", "skill": "money" }).to_string().into_bytes(),
        NearToken::from_yoctonear(0), Gas::from_tgas(20))
    .then(Self::ext(env::current_account_id()).on_licence(/* pay only if licensed */));`,
    js: `const r = await fetch("${location.origin}/api/licence?model=${encodeURIComponent(m)}&skill=money");
const { licensed, reason } = await r.json();
if (!licensed) throw new Error(\`Not paying: \${reason}\`);`,
  };
  const badge = `${location.origin}/api/badge?model=${encodeURIComponent(m)}&skill=money`;
  const tab = (t) => {
    $$("#use-tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.t === t)));
    $("#use-code").hidden = t === "badge"; $("#use-badge").hidden = t !== "badge";
    if (t !== "badge") $("#use-code").textContent = code[t];
    else $("#use-badge").innerHTML = `<img src="${badge}" alt="Proctor licence badge for ${esc(nameOf(m))}"><pre class="cmd">${esc(`![Proctor licence](${badge})`)}</pre>`;
  };
  $("#use-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) tab(b.dataset.t); });
  tab("rust");
}

id ? show(id) : list();
