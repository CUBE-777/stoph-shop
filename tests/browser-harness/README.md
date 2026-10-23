# Browser harness (verification aid, NOT part of the shop)
Runs the real React code in headless Chromium (Playwright) when `npm install` / Vite / a Supabase project were unavailable.
`router-stub.jsx` and `supabase-stub.js` are MOCKS: they prove UI logic only, never RLS, SQL or storage policies.
Paths are hard-coded to the build sandbox (/tmp/harness, /home/claude/...): adapt before reuse.
