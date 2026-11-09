// Public: the product list shown on the website.
import { store, getCatalog, publicCatalog, json } from "./lib/db.mjs";
export default async () => {
  try { return json(publicCatalog(await getCatalog(store()))); }
  catch (e) { console.error(e); return json({ error: "Catalogue unavailable" }, 500); }
};
