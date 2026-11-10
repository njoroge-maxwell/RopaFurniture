// Owner-only: orders, payments, products, photos and reviews. Protected by the ADMIN_PASSWORD Netlify setting.
import crypto from "node:crypto";
import { store, json, readBody, rid, clean, updateJSON, getCatalog, listOrders, totalOf, paidOf, payStatus } from "./lib/db.mjs";

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FULFILMENT = ["new", "in_progress", "ready", "delivered", "cancelled"];
const METHODS = ["cash", "mpesa", "bank", "card", "other"];

const orderRow = (o) => ({
  number: o.number, createdAt: o.createdAt, name: o.customer.name, phone: o.customer.phone, area: o.customer.area,
  total: totalOf(o), paid: paidOf(o), payStatus: payStatus(o), fulfilment: o.fulfilment,
  items: o.items.map((i) => `${i.name} x${i.qty}`).join(", "),
});

function cleanCatalog(input, existing) {
  if (!input || !Array.isArray(input.products)) throw new Error("Bad catalogue");
  const ids = new Set();
  const products = input.products.slice(0, 300).map((p) => {
    const id = Number(p.id);
    if (!Number.isInteger(id) || ids.has(id)) throw new Error("Duplicate or bad product id");
    ids.add(id);
    const name = clean(p.name, 80), category = clean(p.category, 40);
    if (!name || !category) throw new Error("Every product needs a name and a category");
    const price = p.price === null || p.price === "" || p.price === undefined ? null : Number(p.price);
    if (price !== null && (!Number.isInteger(price) || price < 0)) throw new Error(`Price for ${name} must be a whole number`);
    const images = (Array.isArray(p.images) ? p.images : []).slice(0, 8).map((u) => String(u)).filter((u) => /^(images\/[\w.-]+|\/\.netlify\/functions\/image\?id=[a-f0-9]{16,40})$/.test(u));
    return {
      id, name, category, price: price || null, hidden: !!p.hidden,
      description: clean(p.description, 1200),
      specs: (Array.isArray(p.specs) ? p.specs : []).slice(0, 30).map((x) => ({ label: clean(x.label, 60), value: clean(x.value, 200) })).filter((x) => x.label && x.value),
      options: (Array.isArray(p.options) ? p.options : []).slice(0, 5).map((g) => ({ name: clean(g.name, 40), values: (Array.isArray(g.values) ? g.values : []).slice(0, 12).map((v) => {
        const o = typeof v === "string" ? { name: v } : v, name = clean(o.name, 40), pr = Number(o.price), ad = Number(o.add);
        if (!name) return null;
        if (o.price != null && o.price !== "" && (!Number.isInteger(pr) || pr <= 0)) throw new Error(`The price for "${name}" must be a whole number of shillings`);
        if (o.add != null && o.add !== "" && !Number.isInteger(ad)) throw new Error(`The extra amount for "${name}" must be a whole number of shillings`);
        return { name, ...(Number.isInteger(pr) && pr > 0 ? { price: pr } : {}), ...(Number.isInteger(ad) && ad !== 0 ? { add: ad } : {}) };
      }).filter(Boolean) })).filter((g) => g.name && g.values.length),
      images,
    };
  });
  const cats = [];
  for (const c of [...(Array.isArray(input.categories) ? input.categories : existing.categories), ...products.map((p) => p.category)]) if (c && !cats.includes(c)) cats.push(c);
  return { categories: cats, products };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const pw = (process.env.ADMIN_PASSWORD || "").trim();
  if (!pw) return json({ error: "The admin password has not been set up in Netlify yet (ADMIN_PASSWORD)." }, 503);
  const given = req.headers.get("x-admin-password") || "";
  if (!crypto.timingSafeEqual(sha(given), sha(pw))) { await sleep(700); return json({ error: "Wrong password" }, 401); }

  try {
    const s = store();
    const b = await readBody(req);
    const orderOr404 = async (n) => { const o = await s.get(`order:${Number(n)}`, { type: "json" }); return o; };

    switch (b.action) {
      case "ping": return json({ ok: true });

      case "listOrders": return json({ orders: (await listOrders(s)).map(orderRow) });

      case "getOrder": {
        const o = await orderOr404(b.number);
        return o ? json({ order: { ...o, total: totalOf(o), paid: paidOf(o), payStatus: payStatus(o) } }) : json({ error: "Order not found" }, 404);
      }

      case "addPayment": {
        const amount = Number(b.amount), method = METHODS.includes(b.method) ? b.method : "other";
        if (!Number.isInteger(amount) || amount <= 0) return json({ error: "Enter the amount as a whole number of shillings." }, 400);
        const o = await updateJSON(s, `order:${Number(b.number)}`, (o) => { o.payments = [...(o.payments || []), { id: "m-" + rid(4), ref: clean(b.ref, 40) || "manual", amount, method, channel: "", date: new Date().toISOString(), note: clean(b.note, 200) }]; return o; });
        return o ? json({ ok: true }) : json({ error: "Order not found" }, 404);
      }
      case "removePayment": {
        const o = await updateJSON(s, `order:${Number(b.number)}`, (o) => { o.payments = (o.payments || []).filter((p) => p.id !== b.id || p.method === "paystack"); return o; });
        return o ? json({ ok: true }) : json({ error: "Order not found" }, 404);
      }
      case "addAdjustment": {
        const amount = Number(b.amount), label = clean(b.label, 80);
        if (!Number.isInteger(amount) || amount === 0 || !label) return json({ error: "Enter a label and a non-zero whole amount (use a minus sign for a discount)." }, 400);
        const o = await updateJSON(s, `order:${Number(b.number)}`, (o) => { o.adjustments = [...(o.adjustments || []), { label, amount, date: new Date().toISOString() }]; return o; });
        return o ? json({ ok: true }) : json({ error: "Order not found" }, 404);
      }
      case "removeAdjustment": {
        const o = await updateJSON(s, `order:${Number(b.number)}`, (o) => { (o.adjustments || []).splice(Number(b.index), 1); return o; });
        return o ? json({ ok: true }) : json({ error: "Order not found" }, 404);
      }
      case "setFulfilment": {
        if (!FULFILMENT.includes(b.status)) return json({ error: "Bad status" }, 400);
        const o = await updateJSON(s, `order:${Number(b.number)}`, (o) => { o.fulfilment = b.status; return o; });
        return o ? json({ ok: true }) : json({ error: "Order not found" }, 404);
      }
      case "setNotes": {
        const o = await updateJSON(s, `order:${Number(b.number)}`, (o) => { o.notes = clean(b.notes, 1000); return o; });
        return o ? json({ ok: true }) : json({ error: "Order not found" }, 404);
      }
      case "deleteOrder": {   // for removing test orders
        const o = await orderOr404(b.number);
        if (!o) return json({ error: "Order not found" }, 404);
        await s.delete(`order:${o.number}`); await s.delete(`tok:${o.token}`);
        return json({ ok: true });
      }

      case "getCatalog": return json(await getCatalog(s));
      case "saveCatalog": {
        const existing = await getCatalog(s);
        const c = cleanCatalog(b.catalog, existing);
        await s.set("catalog", JSON.stringify(c));
        return json({ ok: true, catalog: c });
      }
      case "uploadImage": {
        const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ""));
        if (!m || m[2].length > 2_500_000) return json({ error: "Please upload a JPG, PNG or WebP photo under about 1.8 MB." }, 400);
        const id = rid(10);
        await s.set(`img:${id}`, JSON.stringify({ type: m[1], b64: m[2] }));
        return json({ url: `/.netlify/functions/image?id=${id}` });
      }

      case "listReviews": {
        const { blobs } = await s.list({ prefix: "review:" });
        const all = (await Promise.all(blobs.map((x) => s.get(x.key, { type: "json" })))).filter(Boolean);
        return json({ reviews: all.sort((a, c) => c.date.localeCompare(a.date)) });
      }
      case "setReview": {
        const r = await updateJSON(s, `review:${clean(b.id, 40)}`, (r) => { r.approved = !!b.approved; return r; });
        return r ? json({ ok: true }) : json({ error: "Review not found" }, 404);
      }
      case "deleteReview": await s.delete(`review:${clean(b.id, 40)}`); return json({ ok: true });
      case "addReview": {
        const name = clean(b.name, 60), comment = clean(b.comment, 600), rating = Number(b.rating);
        if (!name || comment.length < 5 || !Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: "Add a name, a rating (1-5) and a comment." }, 400);
        const id = `${Date.now()}-${rid(3)}`;
        await s.set(`review:${id}`, JSON.stringify({ id, name, rating, comment, product: clean(b.product, 80), date: new Date().toISOString(), approved: true }));
        return json({ ok: true });
      }
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: e.message || "Something went wrong" }, 500);
  }
};
