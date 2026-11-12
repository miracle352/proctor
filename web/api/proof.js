// GET /api/proof?cert=N — everything needed to check certificate N against
// the hardware that produced it, gathered from public sources:
//   - the certificate, from the Proctor contract;
//   - the grader's report as OutLayer handed it back (resolve_execution on
//     outlayer, a few blocks before the certificate), with its request id;
//   - OutLayer's attestation for that request: the Intel TDX quote and the
//     hashes it commits to.
// This function only fetches. The checks run in the visitor's browser
// (src/proof.js), so nothing here needs to be trusted.
import { view, CONTRACT } from "./_lib.js";
import { NET } from "../network.js";

const ARCHIVE = NET.id === "mainnet" ? "https://archival-rpc.mainnet.near.org" : "https://archival-rpc.testnet.near.org";
const API = NET.outlayerApi;
const cache = new Map();
export const config = { maxDuration: 60 };

async function rpc(method, params, url = ARCHIVE) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = await r.json().catch(() => null);
    if (j?.result) return j.result;
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return null;
}

// the report for this certificate: same chat ids, or same model, set and start
const same = (out, c) => out && out.set_id === c.set_id && out.model === c.model && out.start === c.start &&
  (c.chat_ids?.length ? JSON.stringify(out.chat_ids) === JSON.stringify(c.chat_ids) : out.asked === c.asked);

async function findReport(c) {
  // outlayer.testnet lives on shard 5; if the layout changes, read every chunk
  const heights = Array.from({ length: 13 }, (_, i) => c.block_height - i);
  for (const shard of [5, null]) {
    const perBlock = await Promise.all(heights.map(async (b) => {
      if (shard !== null) return [await rpc("chunk", { block_id: b, shard_id: shard })].filter(Boolean);
      const blk = await rpc("block", { block_id: b });
      return blk ? Promise.all(blk.chunks.filter((x) => x.height_included === b).map((x) => rpc("chunk", { chunk_id: x.chunk_hash }))) : [];
    }));
    for (const [k, chunks] of perBlock.entries()) {
      const b = heights[k];
      for (const ch of chunks) {
        for (const r of ch?.receipts || []) {
          if (r.receiver_id !== NET.outlayer) continue;
          for (const a of r.receipt?.Action?.actions || []) {
            const fc = a.FunctionCall;
            if (!fc || fc.method_name !== "resolve_execution") continue;
            const args = JSON.parse(Buffer.from(fc.args, "base64").toString());
            const out = args.response?.output?.Json;
            if (same(out, c)) return { request_id: args.request_id, output: out, block: b };
          }
        }
      }
    }
  }
  return null;
}

export default async function handler(req, res) {
  const id = Number(new URL(req.url, "http://x").searchParams.get("cert"));
  if (!Number.isInteger(id) || id < 0) return res.status(400).json({ error: "Say which certificate: ?cert=N" });
  try {
    if (!cache.has(id)) {
      const [c] = await view("get_certificates", { from: id, limit: 1 });
      if (!c || c.id !== id) return res.status(404).json({ error: "No such certificate" });
      const set = await view("get_set", { set_id: c.set_id });
      const found = await findReport(c);
      if (!found) return res.status(404).json({ error: "Couldn't find OutLayer's result for this certificate in the blocks before it", certificate: c });
      const r = await fetch(`${API}/attestations/by-request/${found.request_id}`);
      const attestation = r.ok ? await r.json() : null;
      cache.set(id, { contract: CONTRACT, network: NET.id, certificate: c, set: { id: c.set_id, keeper: set.keeper, sha256: set.sha256 },
        request_id: found.request_id, resolved_in_block: found.block, output: found.output, attestation,
        outlayer_verifier: attestation ? `https://app.outlayer.ai/attestation/${attestation.task_id}?network=${NET.id}` : null });
    }
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json(cache.get(id));
  } catch (e) {
    res.status(502).json({ error: "Couldn't gather the proof", detail: String(e.message || e) });
  }
}
