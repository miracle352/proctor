import { view, findModel, scores, CONTRACT } from "./_lib.js";

// GET /api/licence?model=gpt-5-nano&skill=money — whether an AI holds a licence,
// read from the contract. The same answer any NEAR contract gets from `licence`.
export default async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const skill = u.searchParams.get("skill") || "money";
  try {
    const m = findModel(await scores(), u.searchParams.get("model"));
    const model = m ? m.model : u.searchParams.get("model");
    const licence = await view("licence", { model, skill });
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "public, s-maxage=30, stale-while-revalidate=120");
    res.status(200).json({ contract: CONTRACT, ...licence });
  } catch (e) {
    res.status(502).json({ error: "Couldn't read the contract on NEAR", detail: String(e.message || e) });
  }
}
