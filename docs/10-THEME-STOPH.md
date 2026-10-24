# STOPH dark-luxury theme (black · chocolate brown · light gold)

Only colours, borders and shadows changed. No layout, route, component logic, data, cart, checkout, auth or admin behaviour was touched.

## Palette (single source: `:root` in `src/styles.css`)
| Token | Hex | Used for |
|---|---|---|
| `--c-black` | #111111 | page background, header, announcement bar, bottom nav, footer |
| `--c-brown` | #5C3828 | selected states (variants, chips, thumbs), sale/discount badges, category-tile hover |
| `--c-gold` | #D6B878 | primary buttons (dark text), active nav, icons, borders, focus ring, count badges |
| `--c-gold-soft` | #E8D5A3 | hover states, footer-link hover, secondary emphasis |
| `--c-white` | #F5F1E8 | main text on dark |
| `--c-gray` | #A8A29E | secondary text, placeholders |

Legacy token names (`--red`, `--yellow`, `--amber`, `--brand-black`) now point to these colours, so every existing rule and component recoloured without being rewritten.

**Derived tints (documented, not new hues):** cards `#3F291F` (brown blended toward black, so gray text keeps AA contrast), fields/steppers `#2F211A`, borders `#4A3F2E`, header/footer hairlines gold at low opacity. Cards are chocolate-brown; the pure `#5C3828` is reserved for selected/promo/badge elements.

**Two deliberate exceptions to "only these colours":** (1) error text uses a muted terracotta (`#E8998A` dark / `#9A3B2B` light) so errors stay distinguishable (colour-only meaning is an accessibility failure); (2) the MFA QR code keeps a white background, otherwise authenticator apps cannot scan it.

## Themes
- **Dark (default):** as above.
- **Light (toggle kept, not removed):** warm-white page, black/brown text, gold buttons with dark text and a brown edge; header, footer and bottom nav stay black. Focus ring becomes chocolate brown (gold is invisible on warm white).

## Logo
The supplied logo artwork (red/yellow) was **not recoloured or replaced**. It now blends into the black header via `mix-blend-mode: lighten`, but its red/yellow does not match the new palette. If STOPH is rebranding, send a gold/brown version of the logo and I will swap the files in `public/brand/` (the favicon was redrawn in gold on black).

## Checks performed
- `npm test`: 53 pass / 0 fail, including new tests: exact palette tokens, **no legacy colours left**, only allow-listed hex values in the stylesheet, no blue/green/purple/hsl, WCAG AA for all text/background pairings in both themes (and ≥3:1 for focus rings).
- Real Chromium over the actual React code (mocked Supabase): **rendered-colour sweep** of 11 pages × 2 themes — every computed text/background/border/outline colour is inside the palette or its tints (one stray default `#000` on the carousel dots was found and fixed).
- Regression after the change: carousel behaviour, swipe, cart → checkout (double-submit protection), admin banner create/edit/schedule/delete, sticky buy bar, product filters, and the 336-combination overflow sweep (6 widths × 14 pages × ar/fr × dark/light): all pass.

## Not verified
Real `vite build`/lint (no network here; the app was bundled with esbuild instead), Safari/Firefox/real devices, and the live Supabase backend. Screens only reachable with real data (e.g. every admin order state, loading skeleton variants) were checked through the colour sweep and shared tokens, not each one visually.

## Files changed
`src/styles.css` (tokens + recolouring + luxury finish), `index.html` (theme-color), `public/favicon.svg`, `tests/storefront.test.js`, `tests/phase3.test.js`, `tests/browser-harness/*`.
