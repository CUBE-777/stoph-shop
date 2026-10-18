import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { imageUrl } from '../lib/supabase.js';
import { MAX_QTY, lineKey } from '../lib/shop.js';

export function CartLines({ editable = true }) {
  const { t, lang, money } = useSettings();
  const { items, update, remove } = useCart();
  return (
    <ul className="lines">
      {items.map((it) => {
        const key = lineKey(it.productId, it.variantId);
        const name = it[`name_${lang}`] || it.name_ar;
        const variant = it[`variant_${lang}`] || it.variant_ar;
        return (
          <li key={key} className={`line${it.unavailable ? ' line-off' : ''}`}>
            {it.image ? <img src={imageUrl(it.image)} alt="" className="line-img" /> : <div className="img-ph line-img" />}
            <div className="line-body">
              <Link to={`/products/${it.slug}`}><strong>{name}</strong></Link>
              {variant && <span className="muted"> — {variant}</span>}
              <div>{money(it.price)}</div>
              {it.unavailable && <p className="bad" role="alert">{t('cart.unavailableLine')}</p>}
            </div>
            {editable ? (
              <div className="line-actions">
                <label className="sr" htmlFor={`q-${key}`}>{t('product.qty')}</label>
                <input id={`q-${key}`} type="number" min="1" max={MAX_QTY} value={it.qty} onChange={(e) => update(key, Number(e.target.value))} />
                <button className="btn btn-ghost" onClick={() => remove(key)}>{t('cart.remove')}</button>
              </div>
            ) : <span>× {it.qty}</span>}
            <strong className="line-total">{money(it.price * it.qty)}</strong>
          </li>
        );
      })}
    </ul>
  );
}

export default function Cart() {
  const { t, money } = useSettings();
  const { items, subtotal, refresh, priceChanged, hasUnavailable } = useCart();
  useEffect(() => { refresh().catch(() => {}); /* eslint-disable-next-line */ }, []);
  if (items.length === 0) return <section className="state"><h1>{t('cart.title')}</h1><p>{t('cart.empty')}</p><Link className="btn btn-primary" to="/products">{t('home.cta')}</Link></section>;
  return (
    <>
      <h1>{t('cart.title')}</h1>
      {priceChanged && <p className="notice" role="status">{t('cart.priceChanged')}</p>}
      <CartLines />
      <div className="summary">
        <p className="row"><span>{t('cart.subtotal')}</span><strong>{money(subtotal)}</strong></p>
        <p className="muted">{t('cart.shippingNote')}</p>
        {hasUnavailable
          ? <button className="btn btn-primary" disabled>{t('cart.checkout')}</button>
          : <Link className="btn btn-primary" to="/checkout">{t('cart.checkout')}</Link>}
      </div>
    </>
  );
}
