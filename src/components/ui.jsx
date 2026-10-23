import { Link } from 'react-router-dom';
import { useFavorites } from '../context/FavoritesContext.jsx';
import { IconHeart } from './Icons.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { errorKey, imageUrl } from '../lib/supabase.js';
import { discountPercent, isOnSale, productAvailability, unitPrice } from '../lib/shop.js';

// Official STOPH SHOP logo (wordmark crop of the supplied artwork, untouched colours). VITE_LOGO_URL still overrides it.
// The header/footer are always dark, matching the logo's own black background, in both themes.
export function Logo({ size = 'header' }) {
  const custom = import.meta.env.VITE_LOGO_URL;
  if (custom) return <img className="logo-img" src={custom} alt="Stoph Shop" height="32" />;
  if (size === 'footer') return <img className="logo-full" src="/brand/logo-full.png" alt="Stoph Shop — Your online store" width="160" height="160" loading="lazy" decoding="async" />;
  return <img className="logo-img" src="/brand/logo-wordmark.png" alt="Stoph Shop" width="593" height="96" decoding="async" />;
}

// Loading / error / empty wrapper for async data.
export function Async({ state, children, empty, isEmpty }) {
  const { t } = useSettings();
  if (state.loading && !state.data) return <p className="state" role="status">{t('common.loading')}</p>;
  if (state.error) {
    return (
      <div className="state state-error" role="alert">
        <p>{t(errorKey(state.error))}</p>
        <button className="btn" onClick={state.reload}>{t('common.retry')}</button>
      </div>
    );
  }
  if (isEmpty && isEmpty(state.data)) return <p className="state">{empty}</p>;
  return children(state.data);
}

export function Field({ label, error, hint, children, htmlFor }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <small className="hint">{hint}</small>}
      {error && <small className="error" id={`${htmlFor}-err`}>{error}</small>}
    </div>
  );
}

export function ProductImage({ product, size = 'card' }) {
  const { t, loc } = useSettings();
  const img = product.product_images?.[0];
  if (!img) return <div className={`img-ph img-${size}`}>{t('product.noImage')}</div>;
  return <img className={`img-${size}`} src={imageUrl(img.path)} alt={img.alt || loc(product, 'name')} loading="lazy" decoding="async" width="400" height="400" />;
}

export function Price({ product }) {
  const { money, t } = useSettings();
  const sale = isOnSale(product);
  return (
    <p className="price">
      <span className="price-now">{money(unitPrice(product))}</span>
      {sale && <>
        <s className="price-old">{money(product.price)}</s>
        <span className="badge badge-sale">{t('product.sale')} −{discountPercent(product)}%</span>
      </>}
    </p>
  );
}

export function FavoriteButton({ product, className = '' }) {
  const { t, loc } = useSettings();
  const fav = useFavorites();
  const on = fav.has(product.id);
  return (
    <button type="button" className={`fav-btn ${className}${on ? ' on' : ''}`} aria-pressed={on}
      aria-label={`${on ? t('fav.remove') : t('fav.add')}: ${loc(product, 'name')}`} onClick={() => fav.toggle(product.id)}>
      <IconHeart filled={on} width={20} height={20} />
    </button>
  );
}

export function ProductCard({ product }) {
  const { loc, t } = useSettings();
  const { available } = productAvailability(product);
  return (
    <article className={`card${available ? '' : ' card-off'}`}>
      <div className="card-media">
        <Link to={`/products/${product.slug}`} className="card-link" tabIndex={-1} aria-hidden="true">
          <ProductImage product={product} />
        </Link>
        {!available && <span className="badge badge-off">{t('product.unavailable')}</span>}
        {available && isOnSale(product) && <span className="badge badge-corner">−{discountPercent(product)}%</span>}
        <FavoriteButton product={product} />
      </div>
      <Link to={`/products/${product.slug}`} className="card-link"><h3 className="card-title">{loc(product, 'name')}</h3></Link>
      <Price product={product} />
    </article>
  );
}
