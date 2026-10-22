import { Link, Navigate, useLocation } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { usePageMeta } from '../lib/meta.js';

export function OrderSuccess() {
  const { t, money } = useSettings();
  usePageMeta({ title: t('success.title'), noindex: true });
  const { state } = useLocation();
  if (!state?.orderNumber) return <Navigate to="/" replace />;
  return (
    <section className="state success" role="status">
      <h1>{t('success.title')}</h1>
      <p>{t('success.number')}: <strong dir="ltr">#{state.orderNumber}</strong></p>
      <p>{t('success.total')}: <strong>{money(state.total)}</strong></p>
      {state.trackingCode && (
        <>
          <p>{t('success.tracking')}: <strong dir="ltr" className="code">{state.trackingCode}</strong></p>
          <p className="muted">{t('success.trackHint')}</p>
          <p><Link to={`/track?code=${state.trackingCode}`}>{t('success.trackLink')}</Link></p>
        </>
      )}
      <p>{t('success.next')}</p>
      <Link className="btn btn-primary" to="/products">{t('success.continue')}</Link>
    </section>
  );
}

export function Info() {
  const { t } = useSettings();
  usePageMeta({ title: t('info.title'), description: t('meta.delivery'), path: '/delivery' });
  return (
    <article className="prose">
      <h1>{t('info.title')}</h1>
      {['delivery', 'payment', 'confirm', 'returns'].map((k) => (
        <section key={k}><h2>{t(`info.${k}H`)}</h2><p>{t(`info.${k}`)}</p></section>
      ))}
    </article>
  );
}

export function Contact() {
  const { t } = useSettings();
  usePageMeta({ title: t('contact.title'), description: t('meta.contact'), path: '/contact' });
  const phone = import.meta.env.VITE_CONTACT_PHONE;
  const wa = import.meta.env.VITE_CONTACT_WHATSAPP;
  const email = import.meta.env.VITE_CONTACT_EMAIL;
  const waDigits = (wa || '').replace(/[^\d]/g, '');
  return (
    <article className="prose">
      <h1>{t('contact.title')}</h1>
      {!phone && !wa && !email && <p className="state">{t('contact.none')}</p>}
      <dl className="contact">
        {phone && <><dt>{t('contact.phone')}</dt><dd><a dir="ltr" href={`tel:${phone.replace(/\s/g, '')}`}>{phone}</a></dd></>}
        {waDigits && <><dt>{t('contact.whatsapp')}</dt><dd><a dir="ltr" href={`https://wa.me/${waDigits}`} target="_blank" rel="noopener noreferrer">{wa}</a></dd></>}
        {email && <><dt>{t('contact.email')}</dt><dd><a dir="ltr" href={`mailto:${email}`}>{email}</a></dd></>}
      </dl>
    </article>
  );
}

export function NotFound() {
  const { t } = useSettings();
  usePageMeta({ title: t('notfound.title'), noindex: true });
  return <section className="state"><h1>{t('notfound.title')}</h1><Link className="btn" to="/">{t('notfound.home')}</Link></section>;
}
