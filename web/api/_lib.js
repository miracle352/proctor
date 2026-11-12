// Server-side reads for the badge and the JSON scores. Same rules as the site:
// only certificates from marking builds the contract lists as comparable count.
import { NET } from "../network.js";
export const CONTRACT = NET.contract;
const RPC = NET.rpc[0];

export async function view(method, args = {}, contract = CONTRACT) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: {
      request_type: "call_function", finality: "final", account_id: contract, method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    } }),
  });
  const j = await res.json();
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error || j.result.error));
  return JSON.parse(Buffer.from(j.result.result).toString());
}

export async function scores() {
  const config = await view("config");
  const sets = Object.fromEntries(await view("list_sets", { from: 0, limit: 200 }));
  const certs = [];
  for (let from = 0; ; from += 100) {
    const b = await view("get_certificates", { from, limit: 100 });
    certs.push(...b);
    if (b.length < 100) break;
  }
  const ok = new Set(config.comparable || [config.grader_version]);
  const grid = {};
  for (const c of certs) {
    if (!ok.has(c.grader_version)) continue;
    const m = (grid[c.model] ||= { sealed: c.sealed, sets: {} });
    const g = (m.sets[c.set_id] ||= {});
    [...c.results].forEach((ch, i) => {
      const k = c.start + i;
      if ((ch === "0" || ch === "1") && !(k in g) && !(sets[c.set_id]?.faulty || []).includes(k)) g[k] = { r: +ch, cert: c.id };
    });
  }
  const isPublished = (id) => id.includes("-original-");
  return Object.entries(grid).map(([model, m]) => {
    const tally = (pred) => {
      let asked = 0, right = 0;
      for (const [sid, g] of Object.entries(m.sets)) if (pred(sid)) for (const v of Object.values(g)) { asked++; right += v.r; }
      return { asked, right, percent: asked ? Math.round((1000 * right) / asked) / 10 : null };
    };
    return {
      model,
      ran_in_secure_hardware: m.sealed,
      sealed: tally((s) => !isPublished(s) && s !== "spike-1"),
      published: tally(isPublished),
      by_set: Object.fromEntries(Object.entries(m.sets).map(([s, g]) => [s, { asked: Object.keys(g).length, right: Object.values(g).reduce((a, v) => a + v.r, 0) }])),
    };
  }).sort((a, b) => (b.sealed.asked - a.sealed.asked) || (b.sealed.percent ?? 0) - (a.sealed.percent ?? 0));
}

export const NAMES = {
  "Qwen/Qwen3.8-27B": "Qwen 3.8", "anthropic/claude-haiku-5-5": "Claude Haiku 5.5", "openai/gpt-5-nano": "GPT-5 nano",
  "google/gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite", "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
};

export function findModel(list, q) {
  q = String(q || "").toLowerCase();
  return list.find((m) => m.model.toLowerCase() === q) || list.find((m) => m.model.toLowerCase().endsWith("/" + q)) || list.find((m) => m.model.toLowerCase().includes(q));
}
