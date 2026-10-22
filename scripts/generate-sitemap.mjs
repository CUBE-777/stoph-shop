// Generates public/sitemap.xml from the published products. Run manually (or in CI) when the catalogue changes:
//   SITE_URL=https://your-domain.ma VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run sitemap
// Uses only the PUBLIC anon key (published products are public anyway). Never put a service_role key here.
import { writeFileSync } from 'node:fs';
import { sitemapXml } from '../src/lib/shop.js';

const { SITE_URL, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = process.env;
if (!SITE_URL || !url || !key) { console.error('Set SITE_URL, VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'); process.exit(1); }
const res = await fetch(`${url}/rest/v1/products?select=slug,updated_at&is_published=eq.true&order=created_at.desc&limit=5000`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) { console.error('Request failed', res.status); process.exit(1); }
const products = await res.json();
writeFileSync(new URL('../public/sitemap.xml', import.meta.url), sitemapXml(SITE_URL.replace(/\/$/, ''), products));
console.log(`sitemap.xml written with ${products.length} products`);
