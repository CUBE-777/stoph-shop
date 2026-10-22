import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { errorKey, imageUrl } from '../lib/supabase.js';
import { discountPercent, isOnSale, productAvailability, unitPrice } from '../lib/shop.js';

// Temporary wordmark. Set VITE_LOGO_URL (or edit this one component) to switch to the final logo.
export function Logo() {
  const logo = import.meta.env.VITE_LOGO_URL;
  if (logo) return <img className="logo-img" src={logo} alt="Stoph Shop" height="32" />;
  return <span className="wordmark" aria-label="Stoph Shop">Stoph<span className="wordmark-dot" aria-hidden="true" />Shop</span>;
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

export function ProductCard({ product }) {
  const { loc, t } = useSettings();
  const { available } = productAvailability(product);
  return (
    <article className={`card${available ? '' : ' card-off'}`}>
      <Link to={`/products/${product.slug}`} className="card-link">
        <div className="card-media">
          <ProductImage product={product} />
          {!available && <span className="badge badge-off">{t('product.unavailable')}</span>}
        </div>
        <h3 className="card-title">{loc(product, 'name')}</h3>
      </Link>
      <Price product={product} />
    </article>
  );
}
