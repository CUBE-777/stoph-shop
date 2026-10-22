import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { getShippingRates, placeOrder, quoteOrder } from '../services/catalog.js';
import { errorKey } from '../lib/supabase.js';
import { normalizeCoupon, normalizePhone, pickShippingFee, toLatinDigits, validateCheckout } from '../lib/shop.js';
import { Field } from '../components/ui.jsx';
import { CartLines } from './Cart.jsx';
import { usePageMeta } from '../lib/meta.js';

export default function Checkout() {
  const { t, money } = useSettings();
  usePageMeta({ title: t('checkout.title'), noindex: true });
  const { items, subtotal, clear, refresh, hasUnavailable } = useCart();
  const navigate = useNavigate();
  const rates = useAsync(getShippingRates, []);
  const [form, setForm] = useState({ full_name: '', phone: '', city: '', address: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState('');            // applied coupon code
  const [couponMsg, setCouponMsg] = useState(null);
  const [quote, setQuote] = useState(null);            // server-computed totals
  const [quoting, setQuoting] = useState(false);
  useEffect(() => { refresh().catch(() => {}); /* eslint-disable-next-line */ }, []);

  // Totals come from the server (it knows coupons, sale windows and shipping rates). Debounced.
  const itemsKey = JSON.stringify(items.map((i) => [i.productId, i.variantId, i.qty]));
  useEffect(() => {
    if (items.length === 0) return undefined;
    let alive = true;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const q = await quoteOrder(items, form.city.trim(), coupon, toLatinDigits(form.phone));
        if (!alive) return;
        if (q?.error) { setCouponMsg({ bad: true, key: `err.${q.error}` }); setCoupon(''); setQuote(null); }
        else { setQuote(q); if (coupon) setCouponMsg({ bad: false, key: 'checkout.couponApplied' }); }
      } catch (err) {
        if (!alive) return;
        setQuote(null);
        if (coupon) { setCouponMsg({ bad: true, key: errorKey(err) }); setCoupon(''); }
      } finally { if (alive) setQuoting(false); }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, form.city, form.phone, coupon]);

  if (items.length === 0) return <section className="state"><h1>{t('checkout.title')}</h1><p>{t('checkout.empty')}</p><Link className="btn" to="/products">{t('home.cta')}</Link></section>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const fee = rates.data ? pickShippingFee(rates.data, form.city) : null;
  const cities = (rates.data || []).filter((r) => !r.is_default).map((r) => r.city);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const clean = { ...form, phone: toLatinDigits(form.phone) };
    const errs = validateCheckout(clean);
    setErrors(errs);
    setSubmitError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const res = await placeOrder({ ...clean, phone: normalizePhone(clean.phone) }, items, coupon);
      clear();
      navigate('/order-success', { replace: true, state: { orderNumber: res.order_number, total: res.total, trackingCode: res.tracking_code } });
    } catch (err) {
      const key = errorKey(err);
      setSubmitError(key);
      if (/unavailable|invalid_variant|variant_required/.test(key)) refresh().catch(() => {});
      if (/coupon/.test(key)) setCoupon('');
    } finally { setBusy(false); }
  };

  return (
    <>
      <h1>{t('checkout.title')}</h1>
      <div className="checkout">
        <form onSubmit={submit} noValidate aria-describedby={submitError ? 'submit-err' : undefined}>
          <Field label={t('checkout.name')} htmlFor="full_name" error={errors.full_name && t(`err.${errors.full_name}`)}>
            <input id="full_name" autoComplete="name" value={form.full_name} onChange={set('full_name')} maxLength={100} aria-invalid={!!errors.full_name} required />
          </Field>
          <Field label={t('checkout.phone')} htmlFor="phone" hint={t('checkout.phoneHint')} error={errors.phone && t(`err.${errors.phone}`)}>
            <input id="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={form.phone} onChange={set('phone')} maxLength={20} aria-invalid={!!errors.phone} required />
          </Field>
          <Field label={t('checkout.city')} htmlFor="city" error={errors.city && t(`err.${errors.city}`)}>
            <input id="city" list="cities" autoComplete="address-level2" value={form.city} onChange={set('city')} maxLength={60} aria-invalid={!!errors.city} required />
            <datalist id="cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label={t('checkout.address')} htmlFor="address" error={errors.address && t(`err.${errors.address}`)}>
            <textarea id="address" rows="3" autoComplete="street-address" value={form.address} onChange={set('address')} maxLength={300} aria-invalid={!!errors.address} required />
          </Field>
          <Field label={t('checkout.notes')} htmlFor="notes" error={errors.notes && t(`err.${errors.notes}`)}>
            <textarea id="notes" rows="2" value={form.notes} onChange={set('notes')} maxLength={500} />
          </Field>
          {Object.keys(errors).length > 0 && <p className="bad" role="alert">{t('checkout.fix')}</p>}
          {submitError && <p className="bad" id="submit-err" role="alert">{t(submitError)}</p>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || hasUnavailable}>
            {busy ? t('checkout.submitting') : t('checkout.submit')}
          </button>
          {hasUnavailable && <p className="bad" role="alert">{t('cart.unavailableLine')} <Link to="/cart">{t('nav.cart')}</Link></p>}
        </form>

        <aside className="summary" aria-label={t('checkout.summary')}>
          <h2>{t('checkout.summary')}</h2>
          <CartLines editable={false} />
          <div className="coupon">
            <label htmlFor="coupon" className="sr">{t('checkout.coupon')}</label>
            <input id="coupon" dir="ltr" placeholder={t('checkout.coupon')} value={couponInput} maxLength={32} autoComplete="off"
              onChange={(e) => setCouponInput(e.target.value)} />
            <button type="button" className="btn" disabled={!couponInput.trim()}
              onClick={() => { setCouponMsg(null); setCoupon(normalizeCoupon(couponInput)); }}>{t('checkout.apply')}</button>
          </div>
          {couponMsg && <p className={couponMsg.bad ? 'bad' : 'ok'} role="status">{t(couponMsg.key)}</p>}
          <p className="row"><span>{t('cart.subtotal')}</span><strong>{money(quote ? quote.subtotal : subtotal)}</strong></p>
          {quote?.coupon_discount > 0 && <p className="row ok"><span>{t('checkout.couponDiscount')} ({quote.coupon_code})</span><strong>−{money(quote.coupon_discount)}</strong></p>}
          <p className="row"><span>{t('checkout.shipping')}</span><strong>{quote ? money(quote.shipping_fee) : fee == null ? t('checkout.shippingTbd') : money(fee)}</strong></p>
          <p className="row total"><span>{t('checkout.total')}</span><strong>{quoting ? '…' : quote ? money(quote.total) : money(fee == null ? subtotal : subtotal + fee)}</strong></p>
          <p className="muted">{t('checkout.payment')}</p>
        </aside>
      </div>
    </>
  );
}
