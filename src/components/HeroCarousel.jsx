// Promotional carousel. Content comes from the `banners` table (managed in Admin > Banners); nothing is hard-coded here.
// Accessible: region + roledescription, labelled prev/next, pagination buttons with aria-current, pause control,
// pauses on hover / keyboard focus / touch, never autoplays under prefers-reduced-motion.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { bannerImageUrl } from '../lib/supabase.js';
import { bannerText, resolveBannerLink, slideIndex, swipeDirection } from '../lib/shop.js';
import { IconChevron, IconPause, IconPlay } from './Icons.jsx';

function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return undefined;
    const on = () => setR(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return r;
}

function Slide({ b, index, total, active, lang, t }) {
  const [broken, setBroken] = useState(false);
  const title = bannerText(b, 'title', lang);
  const sub = bannerText(b, 'subtitle', lang);
  const label = bannerText(b, 'button', lang);
  const alt = bannerText(b, 'image_alt', lang) || '';
  const link = resolveBannerLink(b);
  const desktop = b._imageUrl || bannerImageUrl(b.image_path);
  const mobile = b._mobileUrl || bannerImageUrl(b.mobile_image_path);
  const forced = b._view;   // admin preview only: 'desktop' | 'mobile' (a framed preview cannot rely on viewport media queries)
  const showImg = desktop && !broken;
  const body = (
    <>
      {showImg ? (
        <picture>
          {mobile && !forced && <source media="(max-width: 731px)" srcSet={mobile} />}
          <img className="slide-img" src={forced === 'mobile' && mobile ? mobile : desktop} alt={alt} width="1600" height="600" decoding="async" draggable={false}
            loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : 'auto'} onError={() => setBroken(true)} />
        </picture>
      ) : <div className="slide-fallback" aria-hidden="true" />}
      <div className="slide-scrim" aria-hidden="true" />
      <div className="slide-text">
        <h2 className="slide-title">{title}</h2>
        {sub && <p className="slide-sub">{sub}</p>}
        {link && label && <span className="btn btn-primary slide-cta">{label}</span>}
      </div>
    </>
  );
  const common = { className: 'slide-inner', tabIndex: active ? 0 : -1, draggable: false };
  const wrapper = link
    ? (link.to ? <Link to={link.to} {...common} aria-label={title}>{body}</Link>
      : <a href={link.href} rel="noopener noreferrer" target="_blank" {...common} aria-label={`${title} (${t('carousel.external')})`}>{body}</a>)
    : <div className="slide-inner">{body}</div>;
  return (
    <div className="slide" role="group" aria-roledescription="slide" aria-label={`${index + 1} ${t('carousel.of')} ${total}`} aria-hidden={!active} data-active={active ? 'true' : 'false'}>
      {wrapper}
    </div>
  );
}

export default function HeroCarousel({ banners, settings, view }) {
  const { t, lang } = useSettings();
  const rtl = lang === 'ar';
  const n = banners.length;
  const [i, setI] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [touching, setTouching] = useState(false);
  const reduced = useReducedMotion();
  const start = useRef(null);
  const dragged = useRef(false);
  const go = useCallback((dir) => setI((cur) => slideIndex(cur, n, dir)), [n]);
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);

  const playing = settings.autoplay && !reduced && !userPaused && !hover && !focus && !touching && n > 1;
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => { if (!document.hidden) go(1); }, settings.interval_seconds * 1000);
    return () => clearInterval(id);
  }, [playing, settings.interval_seconds, go]);

  const onPointerDown = (e) => { start.current = { x: e.clientX, y: e.clientY }; setTouching(e.pointerType === 'touch'); };
  const onPointerUp = (e) => {
    const s = start.current; start.current = null; setTouching(false);
    if (!s) return;
    dragged.current = Math.abs(e.clientX - s.x) > 10;       // a drag must not also "click" the slide link underneath
    const d = swipeDirection(e.clientX - s.x, e.clientY - s.y, rtl);
    if (d) go(d);
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { go(rtl ? -1 : 1); e.preventDefault(); } else if (e.key === 'ArrowLeft') { go(rtl ? 1 : -1); e.preventDefault(); }
  };

  if (n === 0) return null;
  const mode = settings.transition === 'fade' ? 'fade' : 'slide';
  return (
    <section className={`hero-carousel hc-${mode}${view ? ` hc-view-${view}` : ''}`} aria-roledescription="carousel" aria-label={t('carousel.label')}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false); }} onKeyDown={onKeyDown}>
      <div className="hc-viewport" onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        onClickCapture={(e) => { if (dragged.current) { e.preventDefault(); e.stopPropagation(); dragged.current = false; } }} onPointerCancel={() => { start.current = null; setTouching(false); }}>
        <div className="hc-track" style={{ '--i': i, '--dir': rtl ? 1 : -1 }} aria-live={playing ? 'off' : 'polite'}>
          {banners.map((b, k) => <Slide key={b.id || k} b={b} index={k} total={n} active={k === i} lang={lang} t={t} />)}
        </div>
      </div>
      {n > 1 && (
        <div className="hc-controls">
          {settings.autoplay && !reduced && (
            <button type="button" className="hc-pause" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? t('carousel.play') : t('carousel.pause')}>
              {userPaused ? <IconPlay width={16} height={16} /> : <IconPause width={16} height={16} />}
            </button>
          )}
          <button type="button" className="hc-btn hc-prev" onClick={() => go(-1)} aria-label={t('carousel.prev')}><IconChevron className="flip" /></button>
          <div className="hc-dots" role="group" aria-label={t('carousel.pagination')}>
            {banners.map((b, k) => (
              <button key={b.id || k} type="button" className="hc-dot" aria-label={`${t('carousel.goto')} ${k + 1}`} aria-current={k === i ? 'true' : undefined} onClick={() => setI(k)} />
            ))}
          </div>
          <button type="button" className="hc-btn hc-next" onClick={() => go(1)} aria-label={t('carousel.next')}><IconChevron /></button>
        </div>
      )}
    </section>
  );
}
