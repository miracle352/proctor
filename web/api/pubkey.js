// POST /api/pubkey — relays a hunter's key request to OutLayer's keystore when
// the browser can't reach it directly. Only the accessor, owner and profile go
// through; the questions are never sent here (secrets_json is always "{}").
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const body = JSON.stringify({ accessor: b.accessor, owner: b.owner, profile: b.profile, secrets_json: "{}" });
  try {
    const r = await fetch("https://testnet-api.outlayer.ai/secrets/pubkey", { method: "POST", headers: { "content-type": "application/json" }, body });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: "OutLayer's keystore didn't answer", detail: String(e.message || e) });
  }
}
