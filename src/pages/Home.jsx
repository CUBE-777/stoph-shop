import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { getCarouselSettings, listBanners, listBestSellers, listCategories, listOnSale, listProducts } from '../services/catalog.js';
import { ProductCard } from '../components/ui.jsx';
import HeroCarousel from '../components/HeroCarousel.jsx';
import { IconBox, IconShield, IconTruck } from '../components/Icons.jsx';
import { CAROUSEL_DEFAULTS } from '../lib/shop.js';
import { usePageMeta } from '../lib/meta.js';

// Branded hero shown when the admin has no eligible banner (or the banners could not be loaded).
function FallbackHero() {
  const { t } = useSettings();
  return (
    <section className="hero-fallback">
      <img src="/brand/logo-mark.png" alt="" width="480" height="360" decoding="async" fetchPriority="high" />
      <div>
        <h1>Stoph Shop</h1>
        <p>{t('home.tagline')}</p>
        <Link className="btn btn-primary" to="/products">{t('home.cta')}</Link>
      </div>
    </section>
  );
}

// A product row: horizontal scroll-snap rail on phones, grid on larger screens. Hidden when there is nothing to show.
function Row({ id, title, state, to }) {
  const { t } = useSettings();
  if (state.loading) return <section aria-labelledby={id}><h2 id={id}>{title}</h2><div className="rail rail-skeleton" aria-hidden="true">{[0, 1, 2, 3].map((k) => <div key={k} className="skeleton-card" />)}</div></section>;
  if (state.error || !state.data || state.data.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <div className="row-head"><h2 id={id}>{title}</h2>{to && <Link className="more-link" to={to}>{t('home.viewAll')}</Link>}</div>
      <div className="rail">{state.data.map((p) => <ProductCard key={p.id} product={p} />)}</div>
    </section>
  );
}

export default function Home() {
  const { t, loc } = useSettings();
  usePageMeta({ title: t('home.cta'), description: t('meta.home'), path: '/' });
  const banners = useAsync(listBanners, []);
  const carousel = useAsync(getCarouselSettings, []);
  const cats = useAsync(listCategories, []);
  const best = useAsync(() => listBestSellers(8), []);
  const fresh = useAsync(() => listProducts({ sort: 'new', limit: 8 }), []);
  const offers = useAsync(() => listOnSale(8), []);
  const picks = useAsync(() => listProducts({ featured: true, limit: 8 }), []);

  const slides = banners.data || [];
  return (
    <>
      {banners.loading ? <div className="hero-carousel hero-skeleton" aria-hidden="true" /> : slides.length > 0
        ? <HeroCarousel banners={slides} settings={carousel.data || CAROUSEL_DEFAULTS} />
        : <FallbackHero />}

      <section className="trust" aria-label={t('home.trustLabel')}>
        {[[IconBox, 'cod', 'codText'], [IconTruck, 'nation', 'nationText'], [IconShield, 'confirm', 'confirmText']].map(([Icon, h, p]) => (
          <div key={h}><Icon width={26} height={26} /><div><h3>{t(`home.${h}`)}</h3><p>{t(`home.${p}`)}</p></div></div>
        ))}
      </section>

      {cats.data?.length > 0 && (
        <section aria-labelledby="h-cats">
          <h2 id="h-cats">{t('home.categories')}</h2>
          <ul className="cat-tiles">
            {cats.data.map((c) => <li key={c.id}><Link className="cat-tile" to={`/products?category=${c.slug}`}>{loc(c, 'name')}</Link></li>)}
          </ul>
        </section>
      )}

      <Row id="h-best" title={t('home.bestSellers')} state={best} to="/products" />
      <Row id="h-new" title={t('home.newArrivals')} state={fresh} to="/products?sort=new" />
      <Row id="h-offers" title={t('home.offers')} state={offers} />
      <Row id="h-picks" title={t('home.recommended')} state={picks} to="/products" />
    </>
  );
}
