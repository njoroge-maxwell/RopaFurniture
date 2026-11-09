// Public: serves product photos you upload from the admin page.
import { store } from "./lib/db.mjs";
export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[a-f0-9]{16,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const rec = await store().get(`img:${id}`, { type: "json" });
  if (!rec) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(rec.b64, "base64"), { headers: { "Content-Type": rec.type, "Cache-Control": "public, max-age=31536000, immutable" } });
};
