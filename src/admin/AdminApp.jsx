import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { isConfigured } from '../lib/supabase.js';
import { getSession, isOwner, mfaAal, mfaStatus, myPermissions, newOrdersFeed, onAuthChange, signOut } from '../services/admin.js';
import { mfaGate } from '../lib/shop.js';
import { MfaChallenge, MfaEnroll, Security } from './Mfa.jsx';
import { Returns } from './Returns.jsx';
import { Banners } from './Banners.jsx';
import { Logo } from '../components/ui.jsx';
import { IconBox, IconChart, IconClose, IconDots, IconGrid, IconHome } from '../components/Icons.jsx';
import { usePageMeta } from '../lib/meta.js';
import { AdminContext } from './context.js';
import { Categories, Dashboard, Login, OrderDetail, Orders, Settings, Shipping } from './Pages.jsx';
import { ProductForm, ProductList } from './Products.jsx';
import { CustomerDetail, Customers } from './Customers.jsx';
import { Coupons, Reports } from './Commerce.jsx';
import { Audit, Staff } from './Staff.jsx';

const SEEN_KEY = 'stoph.admin.seen';

// Polls every 30s (only while the tab is visible) for orders created since the admin last acknowledged them.
function useNewOrders(enabled) {
  const [feed, setFeed] = useState(null);
  const baseTitle = useMemo(() => document.title, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const since = () => localStorage.getItem(SEEN_KEY) || new Date().toISOString();
    if (!localStorage.getItem(SEEN_KEY)) localStorage.setItem(SEEN_KEY, new Date().toISOString());
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const f = await newOrdersFeed(since());
        if (!alive) return;
        setFeed((prev) => {
          // a short buzz on phones when a new order arrives
          if (prev && f.count > prev.count && navigator.vibrate) { try { navigator.vibrate(120); } catch { /* unsupported */ } }
          return f;
        });
      } catch { /* keep last state */ }
    };
    poll();
    const id = setInterval(poll, 30000);
    document.addEventListener('visibilitychange', poll);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', poll); document.title = baseTitle; };
  }, [enabled, baseTitle]);

  useEffect(() => { document.title = feed?.count > 0 ? `(${feed.count}) ${baseTitle}` : baseTitle; }, [feed, baseTitle]);

  const dismiss = () => { if (!feed) return; localStorage.setItem(SEEN_KEY, feed.now); setFeed({ ...feed, count: 0 }); };
  return { feed, dismiss };
}

function NewOrdersBanner({ feed, dismiss }) {
  const { t, money } = useSettings();
  if (!feed || feed.count === 0) return null;
  return (
    <div className="banner new-orders" role="alert">
      <div className="container">
        <strong>{feed.count} {t('admin.newOrders')}</strong>
        <span className="muted no-phone">{feed.latest.map((o) => `#${o.order_number} · ${o.city} · ${money(o.total)}`).join('  |  ')}</span>
        <span className="no-orders-actions">
          <Link className="btn btn-primary" to="/admin/orders" onClick={dismiss}>{t('admin.newOrders.view')}</Link>{' '}
          <button className="btn btn-ghost" onClick={dismiss}>{t('admin.newOrders.dismiss')}</button>
        </span>
      </div>
    </div>
  );
}

// Phone navigation: 3 primary sections + a "More" drawer holding everything else (desktop keeps the top nav).
function AdminBottomNav({ nav, newCount, onSignOut }) {
  const { t } = useSettings();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const icons = { '': IconHome, orders: IconBox, products: IconGrid, reports: IconChart };
  const preferred = ['', 'orders', 'products'];
  let primary = preferred.map((k) => nav.find((n) => n[0] === k)).filter(Boolean);
  if (primary.length < 3) primary = [...primary, ...nav.filter((n) => !primary.includes(n)).slice(0, 3 - primary.length)];
  const rest = nav.filter((n) => !primary.includes(n));

  return (
    <>
      <nav className="admin-bottom" aria-label={t('admin.nav.quick')}>
        {primary.map(([to, label, , end]) => {
          const Ico = icons[to] || IconGrid;
          return (
            <NavLink key={to} to={`/admin/${to}`} end={end || undefined}>
              <span className="bn-ico"><Ico />{to === 'orders' && newCount > 0 && <span className="count">{newCount > 99 ? '99+' : newCount}</span>}</span>
              <span>{label}</span>
            </NavLink>
          );
        })}
        <button type="button" className={open ? 'active' : ''} aria-expanded={open} aria-controls="admin-drawer" onClick={() => setOpen((o) => !o)}>
          <span className="bn-ico"><IconDots /></span><span>{t('admin.nav.more')}</span>
        </button>
      </nav>
      {open && (
        <>
          <button type="button" className="scrim admin-scrim" aria-label={t('admin.nav.close')} onClick={() => setOpen(false)} />
          <div id="admin-drawer" className="admin-drawer" role="dialog" aria-label={t('admin.nav.more')}>
            <div className="row-head"><strong>{t('admin.nav.more')}</strong>
              <button type="button" className="btn btn-ghost" aria-label={t('admin.nav.close')} onClick={() => setOpen(false)}><IconClose /></button></div>
            <ul>
              {rest.map(([to, label]) => <li key={to}><NavLink to={`/admin/${to}`}>{label}</NavLink></li>)}
              <li><Link to="/">{t('admin.nav.store')}</Link></li>
            </ul>
            <button type="button" className="btn btn-block" onClick={onSignOut}>{t('admin.signout')}</button>
          </div>
        </>
      )}
    </>
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

  const ordersLive = !!session && gate === 'ok' && (perms || []).includes('orders.view');
  const orders = useNewOrders(ordersLive);

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
          <nav className="nav open admin-nav only-wide-nav" aria-label="Admin">
            {nav.map(([to, label, , end]) => <NavLink key={to} to={`/admin/${to}`} end={end}>{label}</NavLink>)}
            <Link to="/">{t('admin.nav.store')}</Link>
          </nav>
          <button className="btn btn-ghost" onClick={signOut}>{t('admin.signout')}</button>
        </div></header>
        {can('orders.view') && <NewOrdersBanner feed={orders.feed} dismiss={orders.dismiss} />}
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
        <AdminBottomNav nav={nav} newCount={orders.feed?.count || 0} onSignOut={signOut} />
      </div>
    </AdminContext.Provider>
  );
}
