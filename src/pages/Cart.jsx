import { usePageMeta } from '../lib/meta.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { imageUrl } from '../lib/supabase.js';
import { MAX_QTY, lineKey, lineTotal } from '../lib/shop.js';

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
                <div className="stepper" role="group" aria-label={`${t('product.qty')}: ${name}`}>
                  <button type="button" onClick={() => update(key, it.qty - 1)} disabled={it.qty <= 1} aria-label={t('cart.decrease')}>−</button>
                  <output aria-live="polite">{it.qty}</output>
                  <button type="button" onClick={() => update(key, it.qty + 1)} disabled={it.qty >= MAX_QTY} aria-label={t('cart.increase')}>+</button>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => remove(key)} aria-label={`${t('cart.remove')}: ${name}`}>{t('cart.remove')}</button>
              </div>
            ) : <span>× {it.qty}</span>}
            <strong className="line-total">{money(lineTotal(it.price, it.qty))}</strong>
          </li>
        );
      })}
    </ul>
  );
}

export default function Cart() {
  usePageMeta({ title: useSettings().t('nav.cart'), noindex: true });
  const { t, money } = useSettings();
  const { items, subtotal, refresh, priceChanged, hasUnavailable, clear, count } = useCart();
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => { refresh().catch(() => {}); /* eslint-disable-next-line */ }, []);
  if (items.length === 0) return <section className="state"><h1>{t('cart.title')}</h1><p>{t('cart.empty')}</p><Link className="btn btn-primary" to="/products">{t('home.cta')}</Link></section>;
  return (
    <>
      <div className="row"><h1>{t('cart.title')} <small className="muted">({count})</small></h1>
        {confirmClear ? (
          <span className="row" role="alert">{t('cart.clearConfirm')}
            <button type="button" className="btn" onClick={() => { clear(); setConfirmClear(false); }}>{t('cart.clearYes')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>{t('common.cancel')}</button></span>
        ) : <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(true)}>{t('cart.clear')}</button>}
      </div>
      {priceChanged && <p className="notice" role="status">{t('cart.priceChanged')}</p>}
      <CartLines />
      <div className="summary summary-sticky">
        <p className="row"><span>{t('cart.subtotal')}</span><strong>{money(subtotal)}</strong></p>
        <p className="muted">{t('cart.shippingNote')}</p>
        {hasUnavailable && <p className="bad" role="alert">{t('cart.unavailableLine')}</p>}
        {hasUnavailable
          ? <button type="button" className="btn btn-primary btn-block" disabled>{t('cart.checkout')}</button>
          : <Link className="btn btn-primary btn-block" to="/checkout">{t('cart.checkout')}</Link>}
      </div>
    </>
  );
}
