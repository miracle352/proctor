// GET /api/record?model=<model or agent id> — one AI's whole licence record:
// licences, every exam and hunt it sat, catches, its wallet, and what the
// contracts that rely on its licence did. All read from the chain.
import { view, CONTRACT } from "./_lib.js";
import { NET } from "../network.js";

let cache = { at: 0, certs: [] };
async function allCerts() {
  if (Date.now() - cache.at < 20_000) return cache.certs;
  const { certificates: n } = await view("config");
  const pages = await Promise.all(Array.from({ length: Math.ceil(n / 100) }, (_, i) => view("get_certificates", { from: i * 100, limit: 100 })));
  cache = { at: Date.now(), certs: pages.flat() };
  return cache.certs;
}

const kindOf = (set) => set.startsWith("hunt-") ? "hunt" : set.startsWith("pay-") ? "hard exam" : set.startsWith("money-") ? "wallet exam" : "other";

export default async function handler(req, res) {
  const model = new URL(req.url, "http://x").searchParams.get("model");
  if (!model || model.length > 120) return res.status(400).json({ error: "Say which AI: ?model=…" });
  try {
    const [certs, money, pro, agent, wallets, hunts, budget, vault, agentWallets] = await Promise.all([
      allCerts(),
      view("licence", { model, skill: "money" }),
      view("licence", { model, skill: "money-pro" }),
      model.startsWith("agent:") ? view("get_agent", { agent_id: model }) : null,
      view("list_wallets"),
      view("list_hunts"),
      NET.budget ? view("budget", { model }, NET.budget).catch(() => null) : null,
      NET.vault ? view("attempts", { from: 0, limit: 500 }, NET.vault).catch(() => []) : [],
      NET.wallets ? view("wallets_for", { model }, NET.wallets).catch(() => []) : [],
    ]);
    const mine = certs.filter((c) => c.model === model);
    const huntOf = Object.fromEntries(hunts.map((h) => [h.set_id, h]));
    const events = mine.map((c) => {
      const kind = kindOf(c.set_id), h = huntOf[c.set_id];
      const paid = kind === "hunt" ? c.asked - c.correct - c.failures : undefined;
      return {
        cert: c.id, set: c.set_id, kind, asked: c.asked, right: c.correct, failed: c.failures, block: c.block_height, sealed: c.sealed,
        ...(h ? { hunter: h.set_id.startsWith("hunt-g-drill-") ? "Proctor's drill" : h.set_id.startsWith("hunt-g-") ? h.set_id.split("-")[2] : h.hunter, paid, caught: h.catches.some((x) => x.cert_id === c.id) } : {}),
      };
    }).sort((a, b) => b.block - a.block);
    // one line per exam part: certificates of one set merge, newest first
    const merged = [], seen = {};
    for (const e of events) {
      if (e.kind === "hunt") { merged.push(e); continue; }
      const m = seen[e.set];
      if (m) { m.asked += e.asked; m.right += e.right; m.failed += e.failed; m.certs += 1; continue; }
      merged.push((seen[e.set] = { ...e, certs: 1 }));
    }
    const traps = merged.filter((e) => e.kind === "hunt");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "public, s-maxage=20, stale-while-revalidate=60");
    res.status(200).json({
      contract: CONTRACT, network: NET.id, model, agent: agent ? { owner: agent.owner, name: agent.name, model: agent.model, prompt_sha256: agent.prompt_sha256 } : null,
      licences: { money, "money-pro": pro },
      wallet: wallets.find((w) => w.model === model) || null,
      traps: { faced: traps.length, refused: traps.filter((e) => !e.paid && e.failed < e.asked).length, paid: traps.filter((e) => e.paid > 0).length },
      budget, vault: vault.filter((v) => v.model === model).slice(-10),
      agent_wallets: agentWallets.map((w) => ({ agent: w.agent, owner: w.owner, left: w.left, spent: w.spent, frozen: w.frozen, reason: w.reason })),
      events: merged,
    });
  } catch (e) {
    res.status(502).json({ error: "Couldn't read the contract on NEAR", detail: String(e.message || e) });
  }
}
