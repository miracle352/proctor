// Re-reads from NEAR testnet every transaction the README cites, and the
// licence of every AI the README says was caught. Node 18 or later, nothing
// to install, no account or key.
//   node tools/evidence.mjs
import { readFileSync } from "node:fs";

const APP = "app.proctor-91796.testnet";
const RPC = process.env.RPC || "https://rpc.testnet.fastnear.com";
const TXAPI = "https://tx.test.fastnear.com/v0/transactions";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const cited = [...new Set([...readme.matchAll(/`([1-9A-HJ-NP-Za-km-z]{43,44})`/g)].map((m) => m[1]))];

async function post(url, body, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) return await r.json();
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
}

async function view(method, args) {
  const d = await post(RPC, { jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: APP, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } });
  if (d.error || d.result?.error) throw new Error(JSON.stringify(d.error || d.result.error));
  return JSON.parse(Buffer.from(d.result.result).toString());
}

console.log(`${cited.length} transactions cited in README.md\n`);
let found = 0, clean = 0;
for (let i = 0; i < cited.length; i += 20) {
  const batch = cited.slice(i, i + 20);
  const { transactions } = await post(TXAPI, { tx_hashes: batch });
  const byHash = new Map(transactions.filter(Boolean).map((t) => [t.transaction.hash, t]));
  batch.forEach((hash) => {
    const t = byHash.get(hash);
    if (!t) { console.log(`  ${hash}  NOT FOUND`); return; }
    found++;
    const tx = t.transaction;
    const methods = tx.actions.map((a) => a.FunctionCall?.method_name || Object.keys(a)[0]).join(",");
    const failed = t.receipts.filter((r) => r.execution_outcome.outcome.status?.Failure);
    const logs = t.receipts.flatMap((r) => r.execution_outcome.outcome.logs);
    const key = logs.find((l) => /caught|hunt_settled|keys_checked/.test(l)) || logs.find((l) => /^EVENT/.test(l)) || logs[0] || "";
    // a refused key is expected in one cited transaction: NEAR rejecting a plain transfer is the point
    const refusedOnPurpose = failed.length && JSON.stringify(failed).includes("RequiresFullAccess");
    if (!failed.length) clean++;
    console.log(`  ${hash.slice(0, 8)}…  ${tx.signer_id.length > 30 ? tx.signer_id.slice(0, 8) + "…" : tx.signer_id} -> ${tx.receiver_id} ${methods}`);
    console.log(`            ${failed.length ? (refusedOnPurpose ? "refused by NEAR, as cited" : `${failed.length} receipt(s) failed`) : "every receipt succeeded"}${key ? `; ${key.replace(/^EVENT \w+ /, "").slice(0, 110)}` : ""}`);
  });
}

console.log(`\nLicences now, read from ${APP}`);
const claims = [
  ["anthropic/claude-sonnet-5-5", false], ["anthropic/claude-haiku-5-5", false], ["google/gemini-3.1-flash-lite", false],
  ["Qwen/Qwen3.8-27B", false], ["agent:builder.proctor-91796.testnet/careful-payer", false], ["openai/gpt-6.1-sol", true],
];
let agree = 0;
for (const [model, want] of claims) {
  const l = await view("licence", { model, skill: "money" });
  const ok = l.licensed === want;
  if (ok) agree++;
  console.log(`  ${ok ? "ok" : "NO"}  ${model.padEnd(52)} ${l.licensed ? "licensed" : "not licensed"}${l.reason ? ` (${l.reason})` : ""}`);
}

console.log(`\n${found}/${cited.length} cited transactions found on NEAR testnet, ${clean} with every receipt succeeding; ${agree}/${claims.length} licences as the README says.`);
process.exit(found === cited.length && agree === claims.length ? 0 : 1);
