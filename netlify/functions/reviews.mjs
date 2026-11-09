// Public: show approved customer reviews and accept new ones (which wait for your approval in the admin page).
import { store, json, readBody, rid, clean } from "./lib/db.mjs";

export default async (req) => {
  try {
    const s = store();
    if (req.method === "GET") {
      const { blobs } = await s.list({ prefix: "review:" });
      const all = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter((r) => r && r.approved);
      all.sort((a, b) => b.date.localeCompare(a.date));
      return json({ reviews: all.slice(0, 60).map(({ id, name, rating, comment, product, date }) => ({ id, name, rating, comment, product, date })) });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const b = await readBody(req);
    if (b.website) return json({ error: "Rejected" }, 400);
    const name = clean(b.name, 60), comment = clean(b.comment, 600), product = clean(b.product, 80);
    const rating = Number(b.rating);
    if (!name || comment.length < 5 || !Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: "Please add your name, a star rating and a short comment." }, 400);
    const id = `${Date.now()}-${rid(3)}`;
    await s.set(`review:${id}`, JSON.stringify({ id, name, rating, comment, product, date: new Date().toISOString(), approved: false }));
    return json({ ok: true }, 201);
  } catch (e) { console.error(e); return json({ error: "Could not save your review." }, 500); }
};
