const { chromium } = require('playwright');
const out = []; const ok = (n, c, d = '') => { const l = `${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`; out.push(l); console.log(l); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const uploads = [];
  await page.route('**/storage/v1/object/banner-images/**', async (r) => { const req = r.request(); uploads.push({ url: req.url(), h: req.headers(), size: (req.postDataBuffer() || Buffer.alloc(0)).length }); await r.fulfill({ status: 200, body: '{"Key":"ok"}', contentType: 'application/json' }); });
  await page.goto('http://localhost:4173/admin'); await page.waitForSelector('input[type=password]');
  await page.fill('input[type=email]', 'admin@test.local'); await page.fill('input[type=password]', 'whatever-long-pw'); await page.keyboard.press('Enter');
  await page.waitForSelector('.admin-nav'); 
  const nav = await page.locator('.admin-nav a').allTextContents();
  ok('admin nav has the new Banners entry for banners.manage', nav.some((t) => t.includes('الشرائح')), nav.join(' | '));
  await page.click('.admin-nav a:has-text("الشرائح")'); await page.waitForSelector('table');
  const rows = await page.locator('tbody tr').allTextContents();
  ok('list shows all 4 banners with statuses', rows.length === 4 && rows[0].includes('ظاهرة الآن') && rows[2].includes('منتهية') && rows[3].includes('معطّلة'), rows.map((r) => r.slice(0, 40)).join(' || '));

  // validation
  await page.click('text=شريحة جديدة'); await page.waitForSelector('#b-title_ar');
  await page.click('button:has-text("حفظ")'); await page.waitForTimeout(150);
  ok('empty form: title errors shown, nothing saved', (await page.locator('#b-title_ar[aria-invalid=true]').count()) === 1 && (await page.locator('tbody').count()) === 0);
  await page.fill('#b-title_ar', 'عرض جديد'); await page.fill('#b-title_fr', 'Nouvelle offre');
  await page.selectOption('#b-link_type', 'url'); await page.fill('#b-link_url', 'javascript:alert(1)'); await page.click('button:has-text("حفظ")'); await page.waitForTimeout(150);
  ok('javascript: URL rejected', (await page.locator('text=رابط غير صالح').count()) >= 1);
  await page.fill('#b-link_url', '//evil.example'); await page.click('button:has-text("حفظ")'); await page.waitForTimeout(100);
  ok('protocol-relative URL rejected', (await page.locator('text=رابط غير صالح').count()) >= 1);
  await page.fill('#b-link_url', '/products?category=mode');
  await page.check('label:has-text("مفعّلة") input'); await page.click('button:has-text("حفظ")'); await page.waitForTimeout(150);
  ok('enabled banner without image rejected', (await page.locator('text=تحتاج صورة سطح المكتب').count()) >= 1);
  await page.fill('#b-starts', '2030-01-02T10:00'); await page.fill('#b-ends', '2030-01-01T10:00'); await page.click('button:has-text("حفظ")'); await page.waitForTimeout(100);
  ok('end before start rejected', (await page.locator('text=تاريخ النهاية يجب').count()) >= 1);
  await page.fill('#b-starts', ''); await page.fill('#b-ends', '');
  await page.setInputFiles('#b-img', '/tmp/harness/bad.txt').catch(() => {}); await page.waitForTimeout(100);
  ok('non-image file rejected', (await page.locator('text=الصورة غير صالحة').count()) >= 1);
  // preview with draft + real upload
  await page.setInputFiles('#b-img', '/tmp/harness/banner-test.png'); await page.waitForTimeout(300);
  ok('preview shows draft title', (await page.locator('.preview-frame .slide-title').textContent()) === 'عرض جديد');
  await page.click('.preview-frame ~ * >> nth=0').catch(() => {}); await page.click('button[aria-pressed]:has-text("الهاتف")'); await page.waitForTimeout(200);
  ok('mobile preview frame is narrow', (await page.locator('.preview-frame.pf-mobile').boundingBox()).width <= 361);
  await page.fill('#b-button_ar', 'اكتشف'); await page.waitForTimeout(100);
  ok('preview shows CTA text as typed', (await page.locator('.preview-frame .slide-cta').textContent()) === 'اكتشف');
  await page.click('button:has-text("حفظ")'); await page.waitForSelector('table', { timeout: 5000 });
  ok('upload sent to banner-images bucket with auth + uuid.webp name', uploads.length === 1 && /banner-images\/[0-9a-f-]{36}\.(webp|png|jpg)$/.test(uploads[0].url) && uploads[0].h.authorization === 'Bearer mock', uploads[0]?.url.split('/').slice(-2).join('/'));
  ok('image was compressed/resized before upload (< original png)', uploads[0].size > 0 && uploads[0].size < 20000, `${uploads[0].size} bytes`);
  const rows2 = await page.locator('tbody tr').allTextContents();
  ok('new banner appears in the list', rows2.length === 5 && rows2.some((r) => r.includes('عرض جديد')));
  await page.goto('http://localhost:4173/'); await page.waitForSelector('.slide');
  const titles = await page.locator('.slide-title').allTextContents();
  ok('storefront shows the new enabled banner (3 live now)', titles.length === 3 && titles.includes('عرض جديد'), titles.join(' | '));

  // reorder: move new banner up
  await page.goto('http://localhost:4173/admin/banners'); await page.waitForSelector('table');
  const lastRow = page.locator('tbody tr').nth(4); // sort_order 50 -> new (appended last? index by title)
  const idxNew = (await page.locator('tbody tr').allTextContents()).findIndex((r) => r.includes('عرض جديد'));
  await page.locator('tbody tr').nth(idxNew).locator('button:has-text("↑")').click(); await page.waitForTimeout(400);
  const order = (await page.locator('tbody tr').allTextContents()).map((r) => (r.match(/تخفيضات|وصل حديثاً|عرض جديد|منتهية|معطلة/) || ['?'])[0]);
  ok('move up changes the order', order.indexOf('عرض جديد') === idxNew - 1, order.join(','));
  // edit: change title then disable -> storefront hides it
  await page.locator('tbody tr', { hasText: 'عرض جديد' }).locator('button:has-text("تعديل")').click(); await page.waitForSelector('#b-title_ar');
  ok('edit form is prefilled', (await page.inputValue('#b-title_ar')) === 'عرض جديد' && (await page.inputValue('#b-link_url')) === '/products?category=mode');
  await page.fill('#b-title_ar', 'عرض معدّل'); await page.click('button:has-text("حفظ")'); await page.waitForSelector('table');
  ok('edit saved', (await page.locator('tbody').textContent()).includes('عرض معدّل'));
  await page.locator('tbody tr', { hasText: 'عرض معدّل' }).locator('input[type=checkbox]').uncheck(); await page.waitForTimeout(300);
  await page.goto('http://localhost:4173/'); await page.waitForSelector('.slide');
  ok('disabled banner disappears from storefront', !(await page.locator('.slide-title').allTextContents()).includes('عرض معدّل'));
  // schedule: future start hides, past end hides
  await page.goto('http://localhost:4173/admin/banners'); await page.waitForSelector('table');
  await page.locator('tbody tr', { hasText: 'عرض معدّل' }).locator('button:has-text("تعديل")').click(); await page.waitForSelector('#b-title_ar');
  await page.check('label:has-text("مفعّلة") input'); await page.fill('#b-starts', '2031-01-01T10:00'); await page.click('button:has-text("حفظ")'); await page.waitForSelector('table');
  ok('future-scheduled banner shows status "مجدولة"', (await page.locator('tbody tr', { hasText: 'عرض معدّل' }).textContent()).includes('مجدولة'));
  await page.goto('http://localhost:4173/'); await page.waitForSelector('.slide'); ok('scheduled-in-future banner hidden from storefront', !(await page.locator('.slide-title').allTextContents()).includes('عرض معدّل'));
  // settings
  await page.goto('http://localhost:4173/admin/banners'); await page.waitForSelector('#cs-int');
  await page.fill('#cs-int', '7'); await page.selectOption('#cs-tr', 'fade'); await page.click('form:has(#cs-int) button'); await page.waitForTimeout(300);
  await page.goto('http://localhost:4173/'); await page.waitForSelector('.slide');
  ok('carousel settings (fade) reach the storefront', (await page.locator('.hc-fade').count()) === 1);
  // delete with confirm
  await page.goto('http://localhost:4173/admin/banners'); await page.waitForSelector('table');
  page.once('dialog', (d) => d.accept());
  await page.locator('tbody tr', { hasText: 'عرض معدّل' }).locator('button:has-text("حذف")').click(); await page.waitForTimeout(400);
  ok('delete removes the banner', !(await page.locator('tbody').textContent()).includes('عرض معدّل'));
  ok('no JS errors in admin flow', errs.length === 0, errs.join('|'));
  await ctx.close();

  // ---- UI gating without banners.manage ----
  const c2 = await b.newContext({ viewport: { width: 1280, height: 900 } }); await c2.addInitScript(() => localStorage.setItem('mock.perms', JSON.stringify(['orders.view'])));
  const p2 = await c2.newPage(); await p2.goto('http://localhost:4173/admin'); await p2.waitForSelector('input[type=password]');
  await p2.fill('input[type=email]', 'staff@test.local'); await p2.fill('input[type=password]', 'whatever-long-pw'); await p2.keyboard.press('Enter'); await p2.waitForSelector('.admin-nav');
  ok('staff without banners.manage: no Banners nav entry', !(await p2.locator('.admin-nav a').allTextContents()).some((t) => t.includes('الشرائح')));
  await p2.goto('http://localhost:4173/admin/banners'); await p2.waitForTimeout(500);
  ok('staff without banners.manage: banners route renders nothing', (await p2.locator('text=شريحة جديدة').count()) === 0);
  await c2.close();
  console.log(out.join('\n')); await b.close();
})();
