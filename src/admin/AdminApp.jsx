import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { isConfigured } from '../lib/supabase.js';
import { getSession, isOwner, mfaAal, mfaStatus, myPermissions, newOrdersFeed, onAuthChange, signOut } from '../services/admin.js';
import { mfaGate } from '../lib/shop.js';
import { MfaChallenge, MfaEnroll, Security } from './Mfa.jsx';
import { Returns } from './Returns.jsx';
import { Banners } from './Banners.jsx';
import { Logo } from '../components/ui.jsx';
import { usePageMeta } from '../lib/meta.js';
import { AdminContext } from './context.js';
import { Categories, Dashboard, Login, OrderDetail, Orders, Settings, Shipping } from './Pages.jsx';
import { ProductForm, ProductList } from './Products.jsx';
import { CustomerDetail, Customers } from './Customers.jsx';
import { Coupons, Reports } from './Commerce.jsx';
import { Audit, Staff } from './Staff.jsx';

const SEEN_KEY = 'stoph.admin.seen';

// Polls every 30s for orders created since the last time the admin acknowledged them.
function NewOrdersBanner() {
  const { t, money } = useSettings();
  const [feed, setFeed] = useState(null);
  const baseTitle = useMemo(() => document.title, []);

  useEffect(() => {
    let alive = true;
    const since = () => localStorage.getItem(SEEN_KEY) || new Date().toISOString();
    if (!localStorage.getItem(SEEN_KEY)) localStorage.setItem(SEEN_KEY, new Date().toISOString());
    const poll = async () => {
      try { const f = await newOrdersFeed(since()); if (alive) setFeed(f); } catch { /* keep last state */ }
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(id); document.title = baseTitle; };
  }, [baseTitle]);

  useEffect(() => { document.title = feed?.count > 0 ? `(${feed.count}) ${baseTitle}` : baseTitle; }, [feed, baseTitle]);

  if (!feed || feed.count === 0) return null;
  const dismiss = () => { localStorage.setItem(SEEN_KEY, feed.now); setFeed({ ...feed, count: 0 }); };
  return (
    <div className="banner" role="alert">
      <div className="container">
        <strong>{feed.count} {t('admin.newOrders')}</strong>
        <span className="muted">{feed.latest.map((o) => `#${o.order_number} · ${o.city} · ${money(o.total)}`).join('  |  ')}</span>
        <span>
          <Link className="btn btn-primary" to="/admin/orders" onClick={dismiss}>{t('admin.newOrders.view')}</Link>{' '}
          <button className="btn btn-ghost" onClick={dismiss}>{t('admin.newOrders.dismiss')}</button>
        </span>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const { t } = useSettings();
  usePageMeta({ title: t('admin.title'), noindex: true });
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [perms, setPerms] = useState(null);
  const [gate, setGate] = useState(null);      // null = checking, 'ok' | 'challenge' | 'enroll'
  const [owner, setOwner] = useState(false);
  const [gateTick, setGateTick] = useState(0);

  useEffect(() => {
    if (!isConfigured) return undefined;
    getSession().then(setSession);
    const sub = onAuthChange(setSession);
    return () => sub.unsubscribe();
  }, []);

  // MFA gate first (aal level + server policy), then permissions. The database enforces it again on every request.
  useEffect(() => {
    setGate(null);
    if (!session) return;
    Promise.all([mfaAal(), mfaStatus()]).then(([aal, st]) => setGate(mfaGate(aal, st))).catch(() => setGate('ok'));
  }, [session, gateTick]);

  useEffect(() => {
    setPerms(null);
    if (session && gate === 'ok') {
      myPermissions().then(setPerms).catch(() => setPerms([]));
      isOwner().then(setOwner).catch(() => setOwner(false));
    }
  }, [session, gate]);

  const ctx = useMemo(() => ({ perms: perms || [], can: (p) => (perms || []).includes(p), userId: session?.user?.id || null, isOwner: owner }), [perms, session, owner]);

  if (!isConfigured) return <main className="container main"><p className="state state-error">{t('setup.body')}</p></main>;
  if (session === undefined) return <p className="state" role="status">{t('admin.checking')}</p>;
  if (!session) return <Login />;
  if (gate === null) return <p className="state" role="status">{t('admin.checking')}</p>;
  if (gate === 'challenge') return <MfaChallenge onDone={() => setGateTick((x) => x + 1)} />;
  if (gate === 'enroll') return <MfaEnroll forced onDone={() => setGateTick((x) => x + 1)} />;
  if (perms === null) return <p className="state" role="status">{t('admin.checking')}</p>;
  if (perms.length === 0) {
    return (
      <main className="container main"><section className="state state-error" role="alert">
        <p>{t('admin.noAccess')}</p><button className="btn" onClick={signOut}>{t('admin.signout')}</button>
      </section></main>
    );
  }

  const can = ctx.can;
  const nav = [
    ['', t('admin.nav.dashboard'), can('orders.view'), true],
    ['orders', t('admin.nav.orders'), can('orders.view')],
    ['customers', t('admin.nav.customers'), can('customers.view')],
    ['products', t('admin.nav.products'), can('products.view') || can('products.update') || can('products.create')],
    ['categories', t('admin.nav.categories'), can('categories.manage')],
    ['coupons', t('admin.nav.coupons'), can('coupons.manage')],
    ['returns', t('admin.nav.returns'), can('orders.view')],
    ['banners', t('banners.title'), can('banners.manage')],
    ['reports', t('admin.nav.reports'), can('reports.view')],
    ['shipping', t('admin.nav.shipping'), can('shipping.manage')],
    ['staff', t('admin.nav.staff'), can('staff.manage')],
    ['audit', t('admin.nav.audit'), can('audit.view')],
    ['security', t('mfa.title'), true],
    ['settings', t('admin.nav.settings'), true],
  ].filter((n) => n[2]);

  return (
    <AdminContext.Provider value={ctx}>
      <div className="admin">
        <header className="site-header"><div className="container bar">
          <Link to="/admin" className="brand"><Logo /> <small className="muted">{t('admin.title')}</small></Link>
          <nav className="nav open admin-nav" aria-label="Admin">
            {nav.map(([to, label, , end]) => <NavLink key={to} to={`/admin/${to}`} end={end}>{label}</NavLink>)}
            <Link to="/">{t('admin.nav.store')}</Link>
          </nav>
          <button className="btn btn-ghost" onClick={signOut}>{t('admin.signout')}</button>
        </div></header>
        {can('orders.view') && <NewOrdersBanner />}
        <main className="container main">
          <Routes>
            <Route index element={can('orders.view') ? <Dashboard /> : <Navigate to="settings" replace />} />
            {nav.some((n) => n[0] === 'products') && <>
              <Route path="products" element={<ProductList />} />
              {can('products.create') && <Route path="products/new" element={<ProductForm />} />}
              {can('products.update') && <Route path="products/:id" element={<ProductForm />} />}
            </>}
            {can('categories.manage') && <Route path="categories" element={<Categories />} />}
            {can('orders.view') && <><Route path="orders" element={<Orders />} /><Route path="orders/:id" element={<OrderDetail />} /></>}
            {can('orders.view') && <Route path="returns" element={<Returns />} />}
            {can('banners.manage') && <Route path="banners" element={<Banners />} />}
            <Route path="security" element={<Security />} />
            {can('customers.view') && <><Route path="customers" element={<Customers />} /><Route path="customers/:id" element={<CustomerDetail />} /></>}
            {can('coupons.manage') && <Route path="coupons" element={<Coupons />} />}
            {can('reports.view') && <Route path="reports" element={<Reports />} />}
            {can('shipping.manage') && <Route path="shipping" element={<Shipping />} />}
            {can('staff.manage') && <Route path="staff" element={<Staff />} />}
            {can('audit.view') && <Route path="audit" element={<Audit />} />}
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
