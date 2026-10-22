# إعداد Supabase والنشر على Netlify

## أ) مشروع جديد
1. أنشئ مشروع Supabase. **تذكّر:** المشاريع المجانية تتوقف بعد أسبوع بلا نشاط؛ للمتجر الحقيقي استعمل خطة مدفوعة أو تحقق من الخيارات.
2. SQL Editor: نفّذ بالترتيب **01 ثم 02 ثم 03 ثم 04 (بعد إنشاء حساب المالك في Authentication → Users، وتعديل البريد داخل الملف) ثم [05 اختياري، تجريبي فقط] ثم 06، 07، 08، 09، 10، 11**.
   - 03 قديم جزئياً: دوال الطلب فيه تُستبدل في 08/11؛ لا تُعد تشغيله بعد 08.
   - كل ملف من 06 إلى 11 داخل `begin … commit`: عند أي خطأ لا يُطبَّق شيء. اقرأ رسالة الخطأ ولا تُكمل.
3. اختبر على مشروع تطوير: `tests/db/db_tests.sql` ثم `db_tests_phase2.sql` ثم `db_tests_phase3.sql` (كلها تُلغى بـ rollback). الرسالة المتوقعة في آخر كل ملف: `ALL … PASSED`.

## ب) الترقية من المرحلة 2 (مشروع قائم)
1. **نسخة احتياطية كاملة أولاً** (`03-BACKUP-RESTORE.md`) واختبر الاسترجاع إن أمكن.
2. نفّذ `10_phase3_security.sql` ثم `11_phase3_orders_returns.sql` على **مشروع تطوير** أولاً.
3. بعد التطبيق في الإنتاج: اختبر طلباً تجريبياً، تتبعاً، رفع صورة وحذفها، تقريراً، إلغاءً، ودخول المدير.
4. أعد نشر Edge Function (`supabase functions deploy invite-staff`) لأنها تستدعي `can_grant_roles` الجديدة. إن نشرتها قبل تنفيذ 10 فستفشل الدعوات.
5. **لا تفعّل فرض MFA** قبل إكمال خطوات `02-MFA.md`.

## ج) Edge Function للدعوات
`supabase functions deploy invite-staff` ثم تأكد أن أسرارها (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) مضبوطة في Supabase (تُحقن تلقائياً عادةً). المفتاح الحساس لا يخرج من Supabase.

## د) Netlify
1. اربط المستودع. البناء: `npm run build`، النشر: `dist` (مضبوطان في `netlify.toml`).
2. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (+ اختيارية: `VITE_CONTACT_*`, `VITE_LOGO_URL`). **لا `service_role` هنا أبداً.**
3. أول مرة محلياً: `npm install` (ينتج `package-lock.json`: ارفعه)، ثم `npm audit` و`npm test` و`npm run build`.
4. **CSP:** النشر يحمل `Content-Security-Policy-Report-Only`. افتح الموقع (الرئيسية، منتج، السلة، إتمام الطلب، التتبع، /admin) وراقب Console. إن لم تظهر مخالفات، غيّر اسم الترويسة في `netlify.toml` إلى `Content-Security-Policy` لتصبح مُلزِمة. إن ظهرت مخالفة بسبب نطاق مخصص أضفه إلى `img-src`/`connect-src`.
5. خريطة الموقع (اختياري، تحتاج نطاقك النهائي): `SITE_URL=https://نطاقك VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… npm run sitemap` ثم أضف سطر `Sitemap:` إلى `public/robots.txt`. أعد توليدها عند تغيّر الكتالوج.

## هـ) بعد النشر
نفّذ قائمة الضبط اليدوي في `01-SECURITY-REVIEW.md` §3، ثم `07-REMAINING-ISSUES.md`.
