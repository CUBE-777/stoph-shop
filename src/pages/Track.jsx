import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { Field } from '../components/ui.jsx';
import { errorKey } from '../lib/supabase.js';
import { TRACKING_CODE_RE, normalizePhone, normalizeTrackingCode, toLatinDigits } from '../lib/shop.js';
import { trackOrder } from '../services/catalog.js';

export default function Track() {
  const { t, lang, loc, money } = useSettings();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') || '');
  const [phone, setPhone] = useState('');
  const [state, setState] = useState({ busy: false, error: null, result: null, invalid: false });

  const submit = async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const c = normalizeTrackingCode(code);
    const ph = normalizePhone(toLatinDigits(phone));
    // Same message as "not found": do not reveal which part was wrong.
    if (!TRACKING_CODE_RE.test(c) || !ph) { setState({ busy: false, error: null, result: { found: false }, invalid: true }); return; }
    setState({ busy: true, error: null, result: null, invalid: false });
    try {
      setState({ busy: false, error: null, result: await trackOrder(c, ph), invalid: false });
    } catch (err) {
      setState({ busy: false, error: errorKey(err), result: null, invalid: false });
    }
  };

  const r = state.result;
  const fmt = (d) => new Date(d).toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <article className="prose">
      <h1>{t('track.title')}</h1>
      <p className="muted">{t('track.intro')}</p>
      <form onSubmit={submit} noValidate>
        <Field label={t('track.code')} htmlFor="tcode"><input id="tcode" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="SS-XXXXXXXXXX" autoComplete="off" required /></Field>
        <Field label={t('track.phone')} htmlFor="tphone" hint={t('checkout.phoneHint')}><input id="tphone" type="tel" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} required /></Field>
        <button className="btn btn-primary" disabled={state.busy}>{state.busy ? t('common.loading') : t('track.submit')}</button>
      </form>

      {state.error && <p className="bad" role="alert">{t(state.error)}</p>}
      {r && !r.found && <p className="bad" role="alert">{t('track.notFound')}</p>}
      {r?.found && (
        <section className="track-result" aria-live="polite">
          <p>{t('track.status')}: <span className={`pill st-${r.status}`}>{t(`status.${r.status}`)}</span></p>
          <p className="muted">{t('track.date')}: {fmt(r.created_at)}</p>
          <h2>{t('track.items')}</h2>
          <ul>{r.items.map((i, k) => <li key={k}>{loc(i, 'name')}{(i.variant_ar || i.variant_fr) && <> — {loc(i, 'variant')}</>} × {i.quantity}</li>)}</ul>
          <p>{t('track.total')}: <strong>{money(r.total)}</strong></p>
          <h2>{t('track.history')}</h2>
          <ol className="timeline">{r.history.map((h, k) => <li key={k}><strong>{t(`status.${h.status}`)}</strong> <span className="muted">{fmt(h.at)}</span></li>)}</ol>
        </section>
      )}
    </article>
  );
}
