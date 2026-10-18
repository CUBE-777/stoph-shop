import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { getShippingRates, placeOrder } from '../services/catalog.js';
import { errorKey } from '../lib/supabase.js';
import { normalizePhone, pickShippingFee, toLatinDigits, validateCheckout } from '../lib/shop.js';
import { Field } from '../components/ui.jsx';
import { CartLines } from './Cart.jsx';

export default function Checkout() {
  const { t, money } = useSettings();
  const { items, subtotal, clear, refresh, hasUnavailable } = useCart();
  const navigate = useNavigate();
  const rates = useAsync(getShippingRates, []);
  const [form, setForm] = useState({ full_name: '', phone: '', city: '', address: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { refresh().catch(() => {}); /* eslint-disable-next-line */ }, []);

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
      const res = await placeOrder({ ...clean, phone: normalizePhone(clean.phone) }, items);
      clear();
      navigate('/order-success', { replace: true, state: { orderNumber: res.order_number, total: res.total } });
    } catch (err) {
      const key = errorKey(err);
      setSubmitError(key);
      if (/unavailable|invalid_variant|variant_required/.test(key)) refresh().catch(() => {});
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
          <p className="row"><span>{t('cart.subtotal')}</span><strong>{money(subtotal)}</strong></p>
          <p className="row"><span>{t('checkout.shipping')}</span><strong>{fee == null ? t('checkout.shippingTbd') : money(fee)}</strong></p>
          <p className="row total"><span>{t('checkout.total')}</span><strong>{fee == null ? money(subtotal) : money(subtotal + fee)}</strong></p>
          <p className="muted">{t('checkout.payment')}</p>
        </aside>
      </div>
    </>
  );
}
