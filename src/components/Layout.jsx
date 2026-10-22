import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { Logo } from './ui.jsx';
import { isConfigured } from '../lib/supabase.js';

export default function Layout() {
  const { t, lang, setLang, theme, setTheme } = useSettings();
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const first = useRef(true);
  // Keyboard / screen-reader users: move focus to the content after navigating to another page.
  useEffect(() => { if (first.current) { first.current = false; return; } mainRef.current?.focus({ preventScroll: false }); }, [pathname]);
  const close = () => setOpen(false);
  const nav = [['/', t('nav.home'), true], ['/products', t('nav.products')], ['/track', t('nav.track')], ['/delivery', t('nav.delivery')], ['/contact', t('nav.contact')]];

  return (
    <>
      <a className="skip" href="#main">{t('a11y.skip')}</a>
      <header className="site-header">
        <div className="container bar">
          <Link to="/" className="brand" onClick={close}><Logo /></Link>
          <button className="btn btn-ghost menu-btn" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>{t('nav.menu')}</button>
          <nav id="nav" className={`nav${open ? ' open' : ''}`} aria-label="Main">
            {nav.map(([to, label, end]) => <NavLink key={to} to={to} end={end} onClick={close}>{label}</NavLink>)}
          </nav>
          <div className="tools">
            <button className="btn btn-ghost" onClick={() => setLang(lang === 'ar' ? 'fr' : 'ar')} lang={lang === 'ar' ? 'fr' : 'ar'}>{t('nav.lang')}</button>
            <button className="btn btn-ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('nav.theme')}>
              {theme === 'dark' ? t('theme.light') : t('theme.dark')}
            </button>
            <Link to="/cart" className="btn btn-cart" aria-label={`${t('nav.cart')} (${count})`}>{t('nav.cart')} <span className="count">{count}</span></Link>
          </div>
        </div>
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="container main">
        {!isConfigured ? (
          <section className="state state-error" role="alert"><h1>{t('setup.title')}</h1><p>{t('setup.body')}</p></section>
        ) : <Outlet />}
      </main>
      <footer className="site-footer">
        <div className="container">
          <Logo />
          <p>{t('footer.cod')}</p>
          <p className="muted">© {new Date().getFullYear()} Stoph Shop — {t('footer.rights')}</p>
        </div>
      </footer>
    </>
  );
}
