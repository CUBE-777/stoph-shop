import { createRequire } from 'node:module';
const req = createRequire('/home/claude/.npm-global/lib/node_modules/tsx/package.json');
const esbuild = req('esbuild');
const root = '/home/claude/stoph-shop-main';
await esbuild.build({
  entryPoints: [`${root}/src/main.jsx`], bundle: true, outfile: '/tmp/harness/dist/app.js', format: 'esm', jsx: 'automatic', loader: { '.js': 'jsx', '.css': 'css', '.png': 'file' },
  alias: { 'react-router-dom': '/tmp/harness/router-stub.jsx', '@supabase/supabase-js': '/tmp/harness/supabase-stub.js' },
  nodePaths: ['/home/claude/.npm-global/lib/node_modules'],
  define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://mock.supabase.local"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"anon"', 'import.meta.env.VITE_LOGO_URL': 'undefined', 'import.meta.env.VITE_CONTACT_PHONE': '"+212600000000"', 'import.meta.env.VITE_CONTACT_EMAIL': '"hello@example.test"', 'import.meta.env.VITE_CONTACT_WHATSAPP': '"212600000000"', 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
console.log('bundled');
