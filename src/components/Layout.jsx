import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useFavorites } from '../context/FavoritesContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { listCategories } from '../services/catalog.js';
import { Logo } from './ui.jsx';
import { IconBox, IconCart, IconClose, IconGlobe, IconGrid, IconHeart, IconHome, IconMenu, IconMoon, IconSearch, IconSun } from './Icons.jsx';
import { isConfigured } from '../lib/supabase.js';

function SearchForm({ id, onDone }) {
  const { t } = useSettings();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/products?q=${encodeURIComponent(term)}` : '/products');
    onDone?.();
  };
  return (
    <form className="search" role="search" onSubmit={submit}>
      <label className="sr" htmlFor={id}>{t('search.label')}</label>
      <input id={id} type="search" enterKeyHint="search" autoComplete="off" placeholder={t('search.placeholder')} value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} />
      <button className="search-btn" type="submit" aria-label={t('search.submit')}><IconSearch width={20} height={20} /></button>
    </form>
  );
}

function CountBadge({ n }) { return n > 0 ? <span className="count" aria-hidden="true">{n > 99 ? '99+' : n}</span> : null; }

function Footer() {
  const { t, loc } = useSettings();
  const cats = useAsync(listCategories, []);
  const phone = import.meta.env.VITE_CONTACT_PHONE;
  const wa = import.meta.env.VITE_CONTACT_WHATSAPP;
  const email = import.meta.env.VITE_CONTACT_EMAIL;
  return (
    <footer className="site-footer">
      <div className="container foot-grid">
        <div className="foot-brand">
          <Logo size="footer" />
          <p>{t('footer.cod')}</p>
        </div>
        <nav aria-label={t('footer.shop')}>
          <h2 className="foot-h">{t('footer.shop')}</h2>
          <ul>
            <li><Link to="/products">{t('nav.products')}</Link></li>
            {(cats.data || []).slice(0, 5).map((c) => <li key={c.id}><Link to={`/products?category=${c.slug}`}>{loc(c, 'name')}</Link></li>)}
          </ul>
        </nav>
        <nav aria-label={t('footer.help')}>
          <h2 className="foot-h">{t('footer.help')}</h2>
          <ul>
            <li><Link to="/track">{t('nav.track')}</Link></li>
            <li><Link to="/delivery">{t('nav.delivery')}</Link></li>
            <li><Link to="/contact">{t('nav.contact')}</Link></li>
          </ul>
        </nav>
        <div>
          <h2 className="foot-h">{t('nav.contact')}</h2>
          <ul>
            {phone && <li><a href={`tel:${phone}`} dir="ltr">{phone}</a></li>}
            {wa && <li><a href={`https://wa.me/${String(wa).replace(/\D/g, '')}`} rel="noopener noreferrer" target="_blank">WhatsApp</a></li>}
            {email && <li><a href={`mailto:${email}`} dir="ltr">{email}</a></li>}
            {!phone && !wa && !email && <li><Link to="/contact">{t('nav.contact')}</Link></li>}
          </ul>
        </div>
      </div>
      <div className="container foot-bottom"><p className="muted">© {new Date().getFullYear()} Stoph Shop — {t('footer.rights')}</p></div>
    </footer>
  );
}

export default function Layout() {
  const { t, lang, setLang, theme, setTheme } = useSettings();
  const { count } = useCart();
  const fav = useFavorites();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const prevPath = useRef(pathname);
  // Keyboard / screen-reader users: after navigating to ANOTHER page, scroll to the top and move focus to the content.
  // (Compared with the previous path so React StrictMode's double effect run never steals focus on first load.)
  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, [pathname]);
  useEffect(() => { document.body.classList.toggle('no-scroll', open); return () => document.body.classList.remove('no-scroll'); }, [open]);
  useEffect(() => { if (!open) return undefined; const k = (e) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open]);
  const close = () => setOpen(false);
  const nav = [['/', t('nav.home'), true], ['/products', t('nav.products')], ['/track', t('nav.track')], ['/delivery', t('nav.delivery')], ['/contact', t('nav.contact')]];
  const hideBottom = pathname === '/cart' || pathname === '/checkout';
  const langBtn = (cls) => <button type="button" className={`icon-btn ${cls}`} onClick={() => setLang(lang === 'ar' ? 'fr' : 'ar')} lang={lang === 'ar' ? 'fr' : 'ar'} aria-label={t('nav.langFull')}><IconGlobe /><span className="icon-txt">{t('nav.lang')}</span></button>;
  const themeBtn = (cls) => <button type="button" className={`icon-btn ${cls}`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('nav.theme')}>{theme === 'dark' ? <IconSun /> : <IconMoon />}</button>;

  return (
    <>
      <a className="skip" href="#main">{t('a11y.skip')}</a>
      <div className="announce" role="region" aria-label={t('announce.label')}>
        <div className="container announce-in"><IconBox width={16} height={16} /><span>{t('home.cod')} · {t('home.nation')}</span></div>
      </div>
      <header className="site-header store-header">
        <div className="container hbar">
          <button type="button" className="icon-btn menu-btn" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)} aria-label={t('nav.menu')}>{open ? <IconClose /> : <IconMenu />}</button>
          <Link to="/" className="brand" onClick={close} aria-label="Stoph Shop"><Logo /></Link>
          <div className="hsearch"><SearchForm id="search-d" /></div>
          <div className="tools">
            {langBtn('only-wide')}{themeBtn('only-wide')}
            <Link to="/favorites" className="icon-btn" aria-label={`${t('nav.favorites')} (${fav.count})`}><IconHeart filled={fav.count > 0} /><CountBadge n={fav.count} /></Link>
            <Link to="/cart" className="icon-btn" aria-label={`${t('nav.cart')} (${count})`}><IconCart /><CountBadge n={count} /></Link>
          </div>
          <nav id="nav" className={`nav store-nav${open ? ' open' : ''}`} aria-label={t('nav.main')}>
            {nav.map(([to, label, end]) => <NavLink key={to} to={to} end={end} onClick={close}>{label}</NavLink>)}
            <div className="nav-extra">{langBtn('')}{themeBtn('')}</div>
          </nav>
        </div>
        <div className="container hsearch-m"><SearchForm id="search-m" /></div>
      </header>
      {open && <button type="button" className="scrim" aria-label={t('nav.close')} onClick={close} tabIndex={-1} />}
      <main id="main" ref={mainRef} tabIndex={-1} className="container main">
        {!isConfigured ? (
          <section className="state state-error" role="alert"><h1>{t('setup.title')}</h1><p>{t('setup.body')}</p></section>
        ) : <Outlet />}
      </main>
      <Footer />
      {!hideBottom && (
        <nav className="bottom-nav" aria-label={t('nav.quick')}>
          <NavLink to="/" end><IconHome /><span>{t('nav.home')}</span></NavLink>
          <NavLink to="/products"><IconGrid /><span>{t('nav.products')}</span></NavLink>
          <NavLink to="/favorites"><span className="bn-ico"><IconHeart filled={fav.count > 0} /><CountBadge n={fav.count} /></span><span>{t('nav.favorites')}</span></NavLink>
          <NavLink to="/track"><IconBox /><span>{t('nav.trackShort')}</span></NavLink>
          <NavLink to="/cart"><span className="bn-ico"><IconCart /><CountBadge n={count} /></span><span>{t('nav.cart')}</span></NavLink>
        </nav>
      )}
    </>
  );
}
