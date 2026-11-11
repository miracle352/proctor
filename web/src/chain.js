// Reads come straight from the contract on NEAR testnet. No server, no cache.

export const CONTRACT = "app.proctor-91796.testnet";
export const VAULT = "vault.proctor-91796.testnet";
export const SCAMMER = "scammer.proctor-91796.testnet";
export const NETWORK = "testnet";
export const RPC = "https://rpc.testnet.fastnear.com";
export const EXPLORER = "https://testnet.nearblocks.io";
export const YOCTO = 10n ** 24n;

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.data || j.error.message || "RPC error");
  return j.result;
}

export async function view(method, args = {}, account = CONTRACT) {
  const r = await rpc("query", {
    request_type: "call_function", finality: "final", account_id: account,
    method_name: method, args_base64: btoa(JSON.stringify(args)),
  });
  if (r.error) throw new Error(r.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result)));
}

export async function balance(account) {
  const r = await rpc("query", { request_type: "view_account", finality: "final", account_id: account });
  return BigInt(r.amount);
}

// Logs of a transaction so far. Proctor writes "EVENT proctor certificate ID ..."
// or "EVENT proctor run_failed SET WHY" once the grader has answered.
export async function txEvents(hash, sender) {
  try {
    const r = await rpc("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" });
    const logs = (r.receipts_outcome || []).flatMap((o) => o.outcome.logs);
    return logs.filter((l) => l.startsWith("EVENT proctor"));
  } catch {
    return null;
  }
}

async function paged(method, page = 100) {
  const out = [];
  for (let from = 0; ; from += page) {
    const batch = await view(method, { from, limit: page });
    out.push(...batch);
    if (batch.length < page) return out;
  }
}

export const MODELS = {
  "Qwen/Qwen3.8-27B": { name: "Qwen 3.8", maker: "Alibaba Qwen" },
  "anthropic/claude-haiku-5-5": { name: "Claude Haiku 5.5", maker: "Anthropic" },
  "openai/gpt-5-nano": { name: "GPT-5 nano", maker: "OpenAI" },
  "google/gemini-3.1-flash-lite": { name: "Gemini 3.1 Flash-Lite", maker: "Google" },
  "deepseek/deepseek-v4.1-flash": { name: "DeepSeek V4.1 Flash", maker: "DeepSeek" },
};
export const modelName = (m) => MODELS[m]?.name || m.split("/").pop();
const MAKERS = { openai: "OpenAI", anthropic: "Anthropic", google: "Google", deepseek: "DeepSeek", qwen: "Alibaba Qwen", moonshotai: "Moonshot AI", "z-ai": "Zhipu AI", meta: "Meta" };
export const makerName = (m) => MODELS[m]?.maker || MAKERS[m.split("/")[0].toLowerCase()] || m.split("/")[0].replace(/^./, (c) => c.toUpperCase());

export function setLabel(id) {
  const part = id.split("-").pop().toUpperCase();
  if (id.includes("-original-")) return `Published school maths, part ${part}`;
  if (id.includes("-twin-")) return `Rewritten school maths, part ${part}`;
  if (id.startsWith("hard-")) return `Harder maths, part ${part}`;
  if (id.startsWith("money-")) return `Money exam, part ${part}`;
  if (id === "spike-1") return "Pilot set";
  return id;
}
export const isTwin = (id) => id.includes("-twin-");
export const isOriginal = (id) => id.includes("-original-");
export const isHard = (id) => id.startsWith("hard-");
export const isMoney = (id) => id.startsWith("money-");

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// published-minus-rewritten score per paired question, with a bootstrap 90% interval
function gap(orig, twin) {
  const keys = Object.keys(orig).filter((k) => k in twin);
  if (keys.length < 5) return null;
  const d = keys.map((k) => orig[k] - twin[k]);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const rnd = mulberry(1), boots = [];
  for (let r = 0; r < 4000; r++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[(rnd() * d.length) | 0];
    boots.push(s / d.length);
  }
  boots.sort((a, b) => a - b);
  return { mean, lo: boots[200], hi: boots[3800], n: keys.length };
}

export async function load() {
  const [config, setList, every, pub, wallets, vaultTries] = await Promise.all([
    view("config"),
    view("list_sets", { from: 0, limit: 200 }),
    paged("get_certificates"),
    view("list_public_models").catch(() => []),
    view("list_wallets").catch(() => []),
    view("attempts", { from: 0, limit: 200 }, VAULT).catch(() => []),
  ]);
  const sets = Object.fromEntries(setList);
  const comparable = config.comparable || [config.grader_version];
  // Only builds that mark answers the way the current one does count toward scores.
  const certs = every.filter((c) => comparable.includes(c.grader_version));

  const grid = {}; // model -> set -> question index -> 0/1
  const sealedBy = {};
  for (const c of certs) {
    const faulty = sets[c.set_id]?.faulty || [];
    const g = ((grid[c.model] ||= {})[c.set_id] ||= {});
    [...c.results].forEach((ch, i) => {
      const idx = c.start + i;
      if ((ch === "0" || ch === "1") && !faulty.includes(idx) && !(idx in g)) g[idx] = +ch;
    });
    sealedBy[c.model] = c.sealed;
  }

  const models = Object.entries(grid).map(([model, bySet]) => {
    const perSet = Object.entries(bySet).map(([set_id, r]) => {
      const v = Object.values(r);
      return { set_id, asked: v.length, correct: v.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => a.set_id.localeCompare(b.set_id));
    const fam = { o: {}, t: {} };
    for (const [sid, r] of Object.entries(bySet)) {
      const side = isOriginal(sid) ? "o" : isTwin(sid) ? "t" : null;
      if (!side) continue;
      const part = sid.split("-").pop();
      for (const [i, v] of Object.entries(r)) fam[side][part + i] = v;
    }
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const n = (o) => Object.keys(o).length;
    const hard = Object.entries(bySet).filter(([sid]) => isHard(sid)).flatMap(([, r]) => Object.values(r));
    const sealedAll = Object.entries(bySet).filter(([sid]) => isTwin(sid) || isHard(sid)).flatMap(([, r]) => Object.values(r));
    const money = Object.entries(bySet).filter(([sid]) => isMoney(sid)).flatMap(([, r]) => Object.values(r));
    return {
      model, sealed: sealedBy[model], perSet,
      asked: perSet.reduce((a, s) => a + s.asked, 0),
      correct: perSet.reduce((a, s) => a + s.correct, 0),
      pub: n(fam.o) ? sum(fam.o) / n(fam.o) : null, pubN: n(fam.o),
      fresh: n(fam.t) ? sum(fam.t) / n(fam.t) : null, freshN: n(fam.t),
      gap: gap(fam.o, fam.t),
      hard: hard.length ? sum(hard) / hard.length : null, hardN: hard.length,
      sealedScore: sealedAll.length ? sum(sealedAll) / sealedAll.length : null, sealedN: sealedAll.length,
      money: money.length ? sum(money) / money.length : null, moneyN: money.length,
    };
  }).sort((a, b) => (Math.min(b.sealedN, 60) - Math.min(a.sealedN, 60)) || ((b.sealedScore ?? 0) - (a.sealedScore ?? 0)) || (b.sealed - a.sealed));

  const paid = certs.reduce((a, c) => a + BigInt(c.paid_to_authors), 0n);
  // what each wrongly answered money question cost, for the feed of scams paid
  const lossIds = certs.filter((c) => isMoney(c.set_id) && c.results.includes("0")).map((c) => c.id);
  const losses = Object.fromEntries((await Promise.all(lossIds.map(async (id) => [id, BigInt(await view("cert_loss", { id }).catch(() => "0"))])))
    .filter(([, v]) => v > 0n));
  const licences = Object.fromEntries(await Promise.all(wallets.map(async (w) =>
    [w.model, await view("licence", { model: w.model, skill: "money" }).catch(() => null)])));
  return {
    config, sets, every, certs, models, paid,
    publicModels: Object.fromEntries(pub),
    wallets, licences, vaultTries, losses,
    newest: every.slice().sort((a, b) => b.block_height - a.block_height),
  };
}

export const short = (h, n = 6) => (h && h.length > 2 * n + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);
export const near = (yocto, digits = 3) => (Number(BigInt(yocto) / 10n ** 18n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: digits });
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wait = (ms) => new Promise((r) => setTimeout(r, still ? 0 : ms));

export const LOGO = `<svg viewBox="0 0 40 28" aria-hidden="true" class="logo-mark"><rect x="1.5" y="1.5" width="37" height="25" rx="12.5" fill="none" stroke="currentColor" stroke-width="2.6"/><rect class="logo-fill" x="7" y="7" width="26" height="14" rx="7" fill="currentColor"/><path class="logo-scribble" d="M10 15.5c3-3 5 1.5 8-1.5s5 2 8-.5 4 1.5 5 0" fill="none" stroke="#3ddc5a" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export const ICON = {
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l5 5.5 9-11"/></svg>',
  wrong: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  none: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
};

export const sha256 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Counts up from 0 when the element first scrolls into view.
export function countUp(el, to, { decimals = 0, suffix = "", ms = 1100 } = {}) {
  const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  if (still) { el.textContent = fmt(to); return; }
  const go = () => {
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(to * e);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); go(); } }, { threshold: 0.4 });
  io.observe(el);
}
