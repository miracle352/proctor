import { scores, findModel, NAMES } from "./_lib.js";

// GET /api/badge?model=claude-haiku-5-5 — an SVG badge with the model's score
// on sealed questions, read live from NEAR. Embed it and link it to /verify.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const width = (s, px) => Math.ceil([...s].reduce((w, ch) => w + (/[ilj.,:|!']/.test(ch) ? 0.32 : /[mwMW%]/.test(ch) ? 0.9 : /[A-Z0-9]/.test(ch) ? 0.66 : 0.56), 0) * px);

function svg(left, right, ok) {
  const lw = 34 + width(left, 12) + 12, rw = width(right, 12.5) + 24, w = lw + rw, h = 30;
  const bg = ok ? "#3ddc5a" : "#c7c9ce";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(left)}: ${esc(right)}">
<title>${esc(left)}: ${esc(right)}</title>
<clipPath id="r"><rect width="${w}" height="${h}" rx="8"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="${h}" fill="#0d0e10"/><rect x="${lw}" width="${rw}" height="${h}" fill="${bg}"/></g>
<rect x="10" y="9" width="18" height="12" rx="6" fill="none" stroke="#f3f3f4" stroke-width="1.8"/><rect x="13" y="12" width="12" height="6" rx="3" fill="#3ddc5a"/>
<g font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="12.5" font-weight="600">
<text x="34" y="19.5" fill="#f3f3f4">${esc(left)}</text>
<text x="${lw + 12}" y="19.5" fill="#0d0e10">${esc(right)}</text></g></svg>`;
}

export default async function handler(req, res) {
  const q = new URL(req.url, "http://x").searchParams.get("model");
  let body;
  try {
    const m = findModel(await scores(), q);
    const name = m ? NAMES[m.model] || m.model.split("/").pop() : (q || "unknown model");
    body = m && m.sealed.asked
      ? svg(`${name} on sealed exams`, `${Math.round(m.sealed.percent)}% of ${m.sealed.asked}`, true)
      : svg(`${name} on sealed exams`, "not tested yet", false);
  } catch {
    body = svg("Proctor", "NEAR unreachable", false);
  }
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=120, stale-while-revalidate=600");
  res.status(200).send(body);
}
