// POST /api/guest — hunts for people without a NEAR wallet.
// The visitor's browser seals the questions itself (src/seal.js) with the
// sponsor account as owner; this function only ever receives ciphertext. It
// pays the fees from the sponsor account and signs on the visitor's behalf.
//   {action:"open",  set_id, sha256, size, store}  store = the sealed store_secrets args
//   {action:"fire",  set_id}                      run the hunt against every licence holder
//   {action:"reveal", set_id, plaintext}           publish the questions (the contract checks the hash)
//   {action:"settle", set_id}
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";

export const config = { maxDuration: 60 };

const CONTRACT = "app.proctor-91796.testnet";
const OUTLAYER = "outlayer.testnet";
const PROJECT = "proctor-91796.testnet/grader";
const SKILL = "money";
const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const STAKE = 2n * 10n ** 23n;
const EXEC = 25n * 10n ** 21n;
const PER_DAY = 15;
const NODES = ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];

const provider = new JsonRpcProvider({ url: NODES[0] });
const view = async (method, args = {}) => {
  for (const url of NODES) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
      const j = await r.json();
      if (j.result?.result) return JSON.parse(Buffer.from(j.result.result).toString());
      if (j.result?.error) throw Object.assign(new Error(j.result.error), { final: true });
    } catch (e) { if (e.final) throw e; }
  }
  throw new Error("NEAR testnet isn't answering");
};

const fail = (res, code, error) => res.status(code).json({ error });
const sponsor = () => {
  const id = process.env.SPONSOR_ACCOUNT, key = process.env.SPONSOR_KEY;
  if (!id || !key) return null;
  return new Account(id, provider, KeyPairSigner.fromSecretKey(key));
};
const call = (acct, contractId, methodName, args, deposit, gas = 100n) =>
  acct.callFunctionRaw({ contractId, methodName, args, deposit, gas: gas * TGAS, waitUntil: "INCLUDED_FINAL" });
const panic = (e) => {
  const m = String(e?.message || e).match(/panicked: ([^"\\}]+)/) || String(e?.message || e).match(/Smart contract panicked: (.+)/);
  return m ? m[1] : String(e?.message || e).slice(0, 200);
};

export default async function handler(req, res) {
  if (req.method === "GET") return res.json({ sponsor: process.env.SPONSOR_ACCOUNT || null });
  if (req.method !== "POST") return fail(res, 405, "POST only");
  const acct = sponsor();
  if (!acct) return fail(res, 503, "Guest hunts aren't switched on yet.");
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const id = String(b.set_id || "");
  if (!/^hunt-g-[a-z0-9]{1,16}-[a-z0-9]{6,12}$/.test(id)) return fail(res, 400, "That isn't a guest hunt id.");
  try {
    if (b.action === "open") return await open(acct, id, b, res);
    // a hunt opened a moment ago may not be final yet
    let hunt = null;
    for (let i = 0; i < 6 && !hunt; i++) {
      hunt = await view("get_hunt", { set_id: id });
      if (!hunt) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!hunt || hunt.hunter !== acct.accountId) return fail(res, 404, "No guest hunt with that id.");
    if (b.action === "fire") return await fire(acct, id, hunt, res);
    if (b.action === "reveal") {
      if (typeof b.plaintext !== "string" || b.plaintext.length > 60000) return fail(res, 400, "Send the questions file you saved.");
      await call(acct, CONTRACT, "reveal", { set_id: id, plaintext: b.plaintext }, 0n, 150n);
      return res.json({ ok: true });
    }
    if (b.action === "settle") {
      await call(acct, CONTRACT, "settle_hunt", { set_id: id }, 0n, 150n);
      return res.json({ ok: true });
    }
    return fail(res, 400, "Unknown action.");
  } catch (e) {
    return fail(res, 400, panic(e));
  }
}

async function open(acct, id, b, res) {
  const size = Number(b.size), sha = String(b.sha256 || ""), s = b.store || {};
  if (!(size >= 1 && size <= 3)) return fail(res, 400, "A guest hunt has 1 to 3 traps. Connect a wallet for up to 5.");
  if (!/^[0-9a-f]{64}$/.test(sha)) return fail(res, 400, "Missing the fingerprint.");
  const config = await view("config");
  // only rows the grader build can open, under this hunt's name, sealed by the browser
  if (s.profile !== id || s.accessor?.Project?.project_id !== PROJECT || s.access?.WasmHash?.hash !== config.grader_version
      || typeof s.encrypted_secrets_base64 !== "string" || s.encrypted_secrets_base64.length > 48000 || s.vault_id !== null)
    return fail(res, 400, "The sealed copy isn't in the expected form. Reload the page and try again.");
  const day = Date.now() - 86_400_000;
  const today = (await view("list_hunts")).filter((h) => h.hunter === acct.accountId && h.opened_ms > day).length;
  if (today >= PER_DAY) return fail(res, 429, "Today's free guest hunts are used up. Connect a wallet, or come back tomorrow.");
  const bal = BigInt((await provider.viewAccount(acct.accountId, { finality: "final" })).amount);
  if (bal < 1n * NEAR) return fail(res, 503, "The guest account is out of testnet NEAR. Connect a wallet instead.");
  const storage = BigInt(s.encrypted_secrets_base64.length + 2000) * 10n ** 19n;
  await call(acct, OUTLAYER, "store_secrets", s, storage, 100n);
  await call(acct, CONTRACT, "open_hunt", { set_id: id, sha256: sha, size, skill: SKILL }, STAKE, 50n);
  return res.json({ ok: true });
}

async function fire(acct, id, hunt, res) {
  if (hunt.revealed_ms || hunt.settled) return fail(res, 400, "This hunt is closed.");
  const set = await view("get_set", { set_id: id });
  if (set.runs > 0) return fail(res, 400, "This hunt has already been fired.");
  const [pub, agents] = await Promise.all([view("list_public_models"), view("list_agents")]);
  const fees = Object.fromEntries(pub.map(([m, v]) => [m, BigInt(v.ai_fee)]));
  const candidates = [...Object.keys(fees), ...agents.filter((a) => fees[a.model] !== undefined).map((a) => a.id)];
  const lic = await Promise.all(candidates.map((m) => view("licence", { model: m, skill: SKILL }).catch(() => null)));
  const agentOf = Object.fromEntries(agents.map((a) => [a.id, a]));
  const targets = candidates.filter((m, i) => lic[i]?.licensed);
  const n = BigInt(set.size);
  const sent = [], skipped = [];
  for (const m of targets) {
    const agent = agentOf[m];
    const fee = fees[agent ? agent.model : m] * n + EXEC;
    try {
      // wait only until it's in a block; the grader answers over the next minutes
      await acct.callFunctionRaw({
        contractId: CONTRACT, deposit: fee, gas: 300n * TGAS, waitUntil: "INCLUDED",
        methodName: agent ? "request_agent_run" : "request_run",
        args: agent ? { agent_id: m, set_id: id, start: 0, count: Number(n) } : { set_id: id, model: m, start: 0, count: Number(n) },
      });
      sent.push(m);
    } catch (e) { skipped.push([m, panic(e)]); /* one busy model shouldn't stop the rest */ }
  }
  return res.json({ ok: true, fired: sent, skipped });
}
