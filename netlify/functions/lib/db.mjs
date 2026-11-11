// Shared helpers: storage, catalogue, orders. Everything is kept in Netlify Blobs (store "ropa-data").
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import seed from "./seed.mjs";

export const START = 1001;            // the first order number
export const MIN_PAYMENT = 100;       // smallest custom online payment (KSh) — KEEP IN SYNC with index.html
export const DEPOSIT_RATE = 0.5;

export const store = () => getStore({ name: "ropa-data", consistency: "strong" });

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
export const readBody = async (req) => { try { return await req.json(); } catch { return {}; } };
export const dayKey = (ms = Date.now()) => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);   // days run on Nairobi time (UTC+3)
export const rid = (bytes = 12) => crypto.randomBytes(bytes).toString("hex");
export const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/* ---------- safe read-modify-write (retries if someone else changed it at the same moment) ---------- */
export async function updateJSON(s, key, fn, tries = 6, backoff = 0) {
  for (let i = 0; i < tries; i++) {
    if (i > 0 && backoff) await new Promise((r) => setTimeout(r, Math.random() * backoff * i));   // small random pause so busy moments don't collide again
    const cur = await s.getWithMetadata(key, { type: "json" });
    if (!cur || cur.data == null) return null;
    const next = await fn(structuredClone(cur.data));
    if (next === undefined) return cur.data;               // nothing to change
    const { modified } = await s.set(key, JSON.stringify(next), { onlyIfMatch: cur.etag });
    if (modified) return next;
  }
  throw new Error("Could not save, please try again");
}

/* ---------- catalogue ---------- */
// A choice can simply be a name, or carry a price: { name, price } sets the product's price when chosen,
// { name, add } adds (or subtracts) an amount.
export function normOptions(options) {
  return (options || []).map((g) => ({
    name: g.name,
    values: (g.values || []).map((v) => typeof v === "string" ? { name: v } : { name: v.name, ...(Number.isInteger(v.price) && v.price > 0 ? { price: v.price } : {}), ...(Number.isInteger(v.add) && v.add !== 0 ? { add: v.add } : {}) }),
  }));
}
export function priceFor(p, selected) {
  let price = Number.isInteger(p.price) && p.price > 0 ? p.price : null, add = 0;
  for (const g of p.options || []) {
    const v = g.values.find((x) => x.name === selected?.[g.name]) || g.values[0];
    if (!v) continue;
    if (Number.isInteger(v.price) && v.price > 0) price = v.price;
    if (Number.isInteger(v.add)) add += v.add;
  }
  return price === null ? null : price + add;
}
export async function getCatalog(s = store()) {
  const c = await s.get("catalog", { type: "json" });
  const cat = c && Array.isArray(c.products) ? c : structuredClone(seed);
  cat.products.forEach((p) => { p.options = normOptions(p.options); });
  return cat;
}
export function publicCatalog(c) {
  const products = c.products.filter((p) => !p.hidden);
  const categories = c.categories.filter((cat) => products.some((p) => p.category === cat));
  return { categories, products };
}

/* ---------- orders ---------- */
export const totalOf = (o) =>
  (o.items || []).reduce((s, i) => s + i.price * i.qty, 0) + (o.adjustments || []).reduce((s, a) => s + a.amount, 0);
export const paidOf = (o) => (o.payments || []).reduce((s, p) => s + p.amount, 0);
export const payStatus = (o) => {
  const t = totalOf(o), p = paidOf(o);
  return p <= 0 ? "unpaid" : p >= t ? "paid" : "part";
};
export const publicOrder = (o) => ({
  number: o.number, createdAt: o.createdAt, fulfilment: o.fulfilment,
  customer: { name: o.customer.name, phone: o.customer.phone, email: o.customer.email, area: o.customer.area },
  items: o.items, adjustments: o.adjustments || [],
  payments: (o.payments || []).map((p) => ({ date: p.date, amount: p.amount, method: p.method, ref: p.ref })),
  total: totalOf(o), paid: paidOf(o), balance: Math.max(totalOf(o) - paidOf(o), 0), payStatus: payStatus(o),
});

export async function createOrder(s, data) {
  let n = parseInt(await s.get("next"), 10);
  if (!(n >= START)) n = START;
  const tryClaim = async (from, tries) => {
    for (let i = 0, k = from; i < tries; i++, k++) {
      const rec = { ...data, number: k };
      const { modified } = await s.set(`order:${k}`, JSON.stringify(rec), { onlyIfNew: true });
      if (modified) return rec;
    }
    return null;
  };
  let rec = await tryClaim(n, 60);
  if (!rec) {   // the hint was far behind: continue after the highest number that exists
    const { blobs } = await s.list({ prefix: "order:" });
    const highest = blobs.reduce((m, b) => Math.max(m, parseInt(b.key.slice(6), 10) || 0), START - 1);
    rec = await tryClaim(highest + 1, 60);
  }
  if (!rec) throw new Error("Busy, please try again");
  await s.set("next", String(rec.number + 1));
  await s.set(`tok:${rec.token}`, String(rec.number));
  return rec;
}

export async function getOrderByToken(s, token) {
  if (!/^[a-f0-9]{24}$/.test(String(token || ""))) return null;
  const n = await s.get(`tok:${token}`);
  if (!n) return null;
  const o = await s.get(`order:${n}`, { type: "json" });
  return o && o.token === token ? o : null;
}

export async function listOrders(s) {
  const { blobs } = await s.list({ prefix: "order:" });
  const out = [];
  for (let i = 0; i < blobs.length; i += 25) {
    const chunk = await Promise.all(blobs.slice(i, i + 25).map((b) => s.get(b.key, { type: "json" })));
    out.push(...chunk.filter(Boolean));
  }
  return out.sort((a, b) => b.number - a.number);
}
