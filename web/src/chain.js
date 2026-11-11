// Everything on the page is read straight from the contract on NEAR testnet.
// There is no server and no cached copy.

export const CONTRACT = "app.proctor-91796.testnet";
const RPC = "https://rpc.testnet.fastnear.com";

async function view(method, args = {}) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: {
        request_type: "call_function", finality: "final", account_id: CONTRACT,
        method_name: method, args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const j = await res.json();
  if (j.error || j.result?.error) throw new Error(j.error?.message || j.result.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
}

async function paged(method, page = 50) {
  const out = [];
  for (let from = 0; ; from += page) {
    const batch = await view(method, { from, limit: page });
    out.push(...batch);
    if (batch.length < page) return out;
  }
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// original-minus-twin score per paired question, with a bootstrap 90% interval
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
  const [config, setList, every] = await Promise.all([
    view("config"),
    view("list_sets", { from: 0, limit: 200 }),
    paged("get_certificates"),
  ]);
  const sets = Object.fromEntries(setList);
  // Only the grader build the contract points at now counts toward scores.
  const certs = every.filter((c) => c.grader_version === config.grader_version);

  const grid = {}; // model -> set -> index -> 0/1
  const sealedBy = {};
  for (const c of certs) {
    const faulty = sets[c.set_id]?.faulty || [];
    const g = ((grid[c.model] ||= {})[c.set_id] ||= {});
    [...c.results].forEach((ch, i) => {
      const idx = c.start + i;
      if ((ch === "0" || ch === "1") && !faulty.includes(idx)) g[idx] = +ch;
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
      const side = sid.includes("-original-") ? "o" : sid.includes("-twin-") ? "t" : null;
      if (!side) continue;
      const part = sid.split("-").pop();
      for (const [i, v] of Object.entries(r)) fam[side][part + i] = v;
    }
    const twins = Object.values(fam.t);
    return {
      model, sealed: sealedBy[model], perSet,
      asked: perSet.reduce((a, s) => a + s.asked, 0),
      correct: perSet.reduce((a, s) => a + s.correct, 0),
      twinScore: twins.length ? twins.reduce((a, b) => a + b, 0) / twins.length : null,
      twinN: twins.length,
      gap: gap(fam.o, fam.t),
    };
  }).sort((a, b) => (b.twinN - a.twinN) || (b.correct / b.asked - a.correct / a.asked));

  const paid = certs.reduce((a, c) => a + Number(BigInt(c.paid_to_authors) / 10n ** 18n), 0) / 1e6;
  return { config, sets, certs: certs.slice().reverse(), older: every.length - certs.length, models, paid };
}

export const short = (h, n = 6) => (h.length > 2 * n + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);
export const near = (yocto) => (Number(BigInt(yocto) / 10n ** 18n) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });
