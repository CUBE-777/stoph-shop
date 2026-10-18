import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { isConfigured } from '../lib/supabase.js';
import { getSession, myPermissions, onAuthChange, signOut } from '../services/admin.js';
import { Logo } from '../components/ui.jsx';
import { Categories, Dashboard, Login, OrderDetail, Orders, Settings, Shipping } from './Pages.jsx';
import { ProductForm, ProductList } from './Products.jsx';

export default function AdminApp() {
  const { t } = useSettings();
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [perms, setPerms] = useState(null);

  useEffect(() => {
    if (!isConfigured) return undefined;
    getSession().then(setSession);
    const sub = onAuthChange(setSession);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    setPerms(null);
    if (session) myPermissions().then(setPerms).catch(() => setPerms([]));
  }, [session]);

  if (!isConfigured) return <main className="container main"><p className="state state-error">{t('setup.body')}</p></main>;
  if (session === undefined) return <p className="state" role="status">{t('admin.checking')}</p>;
  if (!session) return <Login />;
  if (perms === null) return <p className="state" role="status">{t('admin.checking')}</p>;
  if (perms.length === 0) {
    return (
      <main className="container main"><section className="state state-error" role="alert">
        <p>{t('admin.noAccess')}</p><button className="btn" onClick={signOut}>{t('admin.signout')}</button>
      </section></main>
    );
  }

  const can = (p) => perms.includes(p);
  const nav = [
    ['', t('admin.nav.dashboard'), can('orders.view'), true],
    ['products', t('admin.nav.products'), can('products.manage')],
    ['categories', t('admin.nav.categories'), can('categories.manage')],
    ['orders', t('admin.nav.orders'), can('orders.view')],
    ['shipping', t('admin.nav.shipping'), can('shipping.manage')],
    ['settings', t('admin.nav.settings'), true],
  ].filter((n) => n[2]);

  return (
    <div className="admin">
      <header className="site-header"><div className="container bar">
        <Link to="/admin" className="brand"><Logo /> <small className="muted">{t('admin.title')}</small></Link>
        <nav className="nav open admin-nav" aria-label="Admin">
          {nav.map(([to, label, , end]) => <NavLink key={to} to={`/admin/${to}`} end={end}>{label}</NavLink>)}
          <Link to="/">{t('admin.nav.store')}</Link>
        </nav>
        <button className="btn btn-ghost" onClick={signOut}>{t('admin.signout')}</button>
      </div></header>
      <main className="container main">
        <Routes>
          <Route index element={can('orders.view') ? <Dashboard /> : <Navigate to="settings" replace />} />
          {can('products.manage') && <><Route path="products" element={<ProductList />} />
            <Route path="products/new" element={<ProductForm />} /><Route path="products/:id" element={<ProductForm />} /></>}
          {can('categories.manage') && <Route path="categories" element={<Categories />} />}
          {can('orders.view') && <><Route path="orders" element={<Orders />} /><Route path="orders/:id" element={<OrderDetail canManage={can('orders.manage')} />} /></>}
          {can('shipping.manage') && <Route path="shipping" element={<Shipping />} />}
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
