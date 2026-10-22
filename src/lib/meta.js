// Per-page <title>, description, canonical, Open Graph and optional JSON-LD for a client-rendered SPA.
// Honest limit: Google renders JavaScript and reads these; WhatsApp/Facebook/X link previews do NOT run JS and
// only see the static tags in index.html. See docs/07-REMAINING-ISSUES.md (SEO section) for the options.
import { useEffect } from 'react';
import { truncateText } from './shop.js';

const SITE = 'Stoph Shop';
function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!value) { el?.remove(); return; }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', value);
}
function setLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!href) { el?.remove(); return; }
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); document.head.appendChild(el); }
  el.setAttribute('href', href);
}

export function usePageMeta({ title, description, path, image, jsonLd, noindex } = {}) {
  useEffect(() => {
    const full = title ? `${title} — ${SITE}` : SITE;
    const desc = truncateText(description || '');
    const url = path != null ? `${window.location.origin}${path}` : null;
    document.title = full;
    setMeta('name', 'description', desc);
    setMeta('name', 'robots', noindex ? 'noindex,nofollow' : null);
    setLink('canonical', url);
    setMeta('property', 'og:title', full);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:type', jsonLd ? 'product' : 'website');
    setMeta('property', 'og:image', image || null);
    setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    let ld = document.getElementById('ld-json');
    if (jsonLd) {
      if (!ld) { ld = document.createElement('script'); ld.id = 'ld-json'; ld.type = 'application/ld+json'; document.head.appendChild(ld); }
      ld.textContent = JSON.stringify(jsonLd);
    } else ld?.remove();
    return () => { document.getElementById('ld-json')?.remove(); };
  }, [title, description, path, image, noindex, JSON.stringify(jsonLd)]); // eslint-disable-line react-hooks/exhaustive-deps
}
