import { NET } from "../network.js";
import { scores, CONTRACT } from "./_lib.js";

// GET /api/scores — every model's sealed and published scores, read from NEAR.
export default async function handler(req, res) {
  try {
    const list = await scores();
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ contract: CONTRACT, network: NET.id, read_at: new Date().toISOString(), models: list });
  } catch (e) {
    res.status(502).json({ error: "Couldn't read the contract on NEAR", detail: String(e.message || e) });
  }
}
