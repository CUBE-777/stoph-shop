import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Async, Field, Logo } from '../components/ui.jsx';
import { errorKey } from '../lib/supabase.js';
import { ORDER_STATUSES, allowedNextStatuses, whatsappMessage, whatsappUrl } from '../lib/shop.js';
import { useAdmin } from './context.js';
import {
  adminCategories, adminOrder, adminOrders, adminShipping, dashboard, deleteCategory, deleteShipping, orderHistory,
  saveCategory, saveShipping, setOrderStatus, signIn, updatePassword,
} from '../services/admin.js';

export function Login() {
  const { t } = useSettings();
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await signIn(f.email.trim(), f.password); } catch { setErr(t('admin.badLogin')); } finally { setBusy(false); }
  };
  return (
    <main className="container main login">
      <form onSubmit={submit} className="admin-form">
        <Logo /><h1>{t('admin.login')}</h1>
        <Field label={t('admin.email')} htmlFor="em"><input id="em" type="email" autoComplete="username" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label={t('admin.password')} htmlFor="pw"><input id="pw" type="password" autoComplete="current-password" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        {err && <p className="bad" role="alert">{err}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t('common.loading') : t('admin.signin')}</button>
      </form>
    </main>
  );
}

export function Dashboard() {
  const { t, money } = useSettings();
  const state = useAsync(dashboard, []);
  return (
    <>
      <h1>{t('admin.nav.dashboard')}</h1>
      <Async state={state}>
        {(d) => (
          <>
            <div className="stats">
              {[['today', d.orders_today], ['pending', d.pending], ['revenue', money(d.delivered_revenue)], ['published', d.published_products], ['unavailable', d.unavailable_products]]
                .map(([k, v]) => <div className="stat" key={k}><strong>{v}</strong><span>{t(`admin.dash.${k}`)}</span></div>)}
            </div>
            <h2>{t('admin.dash.byStatus')}</h2>
            <ul className="status-list">{ORDER_STATUSES.map((s) => <li key={s}><span>{t(`status.${s}`)}</span><strong>{d.by_status?.[s] || 0}</strong></li>)}</ul>
          </>
        )}
      </Async>
    </>
  );
}

export function Categories() {
  const { t } = useSettings();
  const state = useAsync(adminCategories, []);
  const [draft, setDraft] = useState({ name_ar: '', name_fr: '', sort_order: 0, is_active: true });
  const [msg, setMsg] = useState(null);
  const run = async (fn) => { setMsg(null); try { await fn(); state.reload(); } catch (e) { setMsg(t(errorKey(e))); } };
  return (
    <>
      <h1>{t('admin.nav.categories')}</h1>
      {msg && <p className="bad" role="alert">{msg}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>{t('admin.cat.nameAr')}</th><th>{t('admin.cat.nameFr')}</th><th>{t('admin.cat.order')}</th><th>{t('common.active')}</th><th>{t('common.actions')}</th></tr></thead>
        <tbody>
          {(state.data || []).map((c) => <CategoryRow key={c.id} c={c} onSave={(v) => run(() => saveCategory(v))} onDelete={() => window.confirm(t('common.confirmDelete')) && run(() => deleteCategory(c.id))} />)}
          <tr>
            <td><input aria-label={t('admin.cat.nameAr')} dir="rtl" value={draft.name_ar} onChange={(e) => setDraft({ ...draft, name_ar: e.target.value })} /></td>
            <td><input aria-label={t('admin.cat.nameFr')} dir="ltr" value={draft.name_fr} onChange={(e) => setDraft({ ...draft, name_fr: e.target.value })} /></td>
            <td><input type="number" aria-label={t('admin.cat.order')} value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} /></td>
            <td><input type="checkbox" aria-label={t('common.active')} checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /></td>
            <td><button className="btn btn-primary" onClick={() => run(async () => { await saveCategory(draft); setDraft({ name_ar: '', name_fr: '', sort_order: 0, is_active: true }); })}>{t('common.add')}</button></td>
          </tr>
        </tbody>
      </table></div>
      {state.data?.length === 0 && <p className="state">{t('admin.cat.empty')}</p>}
    </>
  );
}
function CategoryRow({ c, onSave, onDelete }) {
  const { t } = useSettings();
  const [v, setV] = useState(c);
  return (
    <tr>
      <td><input aria-label={t('admin.cat.nameAr')} dir="rtl" value={v.name_ar} onChange={(e) => setV({ ...v, name_ar: e.target.value })} /></td>
      <td><input aria-label={t('admin.cat.nameFr')} dir="ltr" value={v.name_fr} onChange={(e) => setV({ ...v, name_fr: e.target.value })} /></td>
      <td><input type="number" aria-label={t('admin.cat.order')} value={v.sort_order} onChange={(e) => setV({ ...v, sort_order: e.target.value })} /></td>
      <td><input type="checkbox" aria-label={t('common.active')} checked={v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /></td>
      <td className="actions"><button className="btn" onClick={() => onSave(v)}>{t('common.save')}</button><button className="btn btn-ghost" onClick={onDelete}>{t('common.delete')}</button></td>
    </tr>
  );
}

export function Orders() {
  const { t, lang, money } = useSettings();
  const empty = { number: '', status: '', phone: '', city: '', from: '', to: '' };
  const [draft, setDraft] = useState(empty);
  const [filters, setFilters] = useState(empty);
  const state = useAsync(() => adminOrders(filters), [JSON.stringify(filters)]);
  const fmt = (d) => new Date(d).toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA', { dateStyle: 'short', timeStyle: 'short' });
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const apply = (e) => { e.preventDefault(); setFilters(draft); };
  const reset = () => { setDraft(empty); setFilters(empty); };
  return (
    <>
      <h1>{t('admin.nav.orders')}</h1>
      <form onSubmit={apply} className="filters-orders" role="search">
        <Field label={t('admin.orders.search')} htmlFor="f-num"><input id="f-num" inputMode="numeric" value={draft.number} onChange={set('number')} maxLength={12} /></Field>
        <Field label={t('admin.orders.filter')} htmlFor="f-st">
          <select id="f-st" value={draft.status} onChange={set('status')}>
            <option value="">{t('common.all')}</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
        </Field>
        <Field label={t('admin.orders.phone')} htmlFor="f-ph"><input id="f-ph" dir="ltr" inputMode="tel" value={draft.phone} onChange={set('phone')} maxLength={20} /></Field>
        <Field label={t('admin.orders.city')} htmlFor="f-city"><input id="f-city" value={draft.city} onChange={set('city')} maxLength={40} /></Field>
        <Field label={t('admin.orders.from')} htmlFor="f-from"><input id="f-from" type="date" value={draft.from} onChange={set('from')} /></Field>
        <Field label={t('admin.orders.to')} htmlFor="f-to"><input id="f-to" type="date" value={draft.to} onChange={set('to')} /></Field>
        <div className="row"><button className="btn btn-primary">{t('common.search')}</button><button type="button" className="btn btn-ghost" onClick={reset}>{t('admin.orders.reset')}</button></div>
      </form>
      <Async state={state} empty={t('admin.orders.empty')} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('admin.orders.number')}</th><th>{t('admin.orders.customer')}</th><th>{t('checkout.city')}</th><th>{t('checkout.total')}</th><th>{t('admin.orders.date')}</th><th></th></tr></thead>
            <tbody>{d.map((o) => (
              <tr key={o.id}>
                <td dir="ltr">#{o.order_number}</td><td>{o.customer_name}<br /><small dir="ltr">{o.phone}</small></td><td>{o.city}</td>
                <td>{money(o.total)}</td><td>{fmt(o.created_at)}</td>
                <td><span className={`pill st-${o.status}`}>{t(`status.${o.status}`)}</span> <Link className="btn" to={`/admin/orders/${o.id}`}>{t('common.edit')}</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Async>
    </>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const { t, lang, loc, money } = useSettings();
  const { can } = useAdmin();
  const state = useAsync(() => adminOrder(id), [id]);
  const hist = useAsync(() => orderHistory(id), [id]);
  const [msg, setMsg] = useState(null);
  const [note, setNote] = useState('');
  const fmt = (d) => new Date(d).toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA', { dateStyle: 'short', timeStyle: 'short' });

  const change = async (s) => {
    setMsg(null);
    try { await setOrderStatus(id, s, note); setNote(''); state.reload(); hist.reload(); } catch (e) { setMsg(t(errorKey(e))); }
  };
  return (
    <Async state={state}>
      {(o) => {
        const next = allowedNextStatuses(o.status, can);
        const wa = whatsappUrl(o.phone, whatsappMessage(lang, {
          firstName: o.customer_name.split(' ')[0], orderNumber: o.order_number,
          items: o.order_items.map((i) => ({ name: loc(i, 'product_name'), variant: loc(i, 'variant_label'), qty: i.quantity })),
          total: Number(o.total), currency: t('common.currency'), city: o.city,
          trackUrl: `${window.location.origin}/track?code=${o.tracking_code}`,
        }));
        return (
          <>
            <p><Link to="/admin/orders">← {t('common.back')}</Link></p>
            <h1 dir="ltr">#{o.order_number} <span className={`pill st-${o.status}`}>{t(`status.${o.status}`)}</span></h1>
            <dl className="contact">
              <dt>{t('admin.orders.customer')}</dt>
              <dd>{o.customer_name} — <a dir="ltr" href={`tel:${o.phone}`}>{o.phone}</a>
                {can('customers.view') && o.customer_id && <> · <Link to={`/admin/customers/${o.customer_id}`}>{t('admin.orders.viewCustomer')}</Link></>}</dd>
              <dt>{t('checkout.city')}</dt><dd>{o.city}</dd>
              <dt>{t('admin.orders.address')}</dt><dd>{o.address}</dd>
              {o.notes && <><dt>{t('admin.orders.notes')}</dt><dd>{o.notes}</dd></>}
              <dt>{t('admin.orders.tracking')}</dt><dd dir="ltr" className="code">{o.tracking_code}</dd>
              {o.coupon_code && <><dt>{t('admin.orders.coupon')}</dt><dd dir="ltr">{o.coupon_code} (−{money(o.coupon_discount)})</dd></>}
            </dl>
            {wa && (
              <p><a className="btn" href={wa} target="_blank" rel="noopener noreferrer">{t('admin.orders.whatsapp')}</a>
                <small className="muted"> {t('admin.orders.whatsappNote')}</small></p>
            )}
            <h2>{t('admin.orders.items')}</h2>
            <div className="table-wrap"><table>
              <tbody>{o.order_items.map((i) => (
                <tr key={i.id}>
                  <td>{loc(i, 'product_name')}{(i.variant_label_ar || i.variant_label_fr) && <> — {loc(i, 'variant_label')}</>}</td>
                  <td>{money(i.unit_final_price)}{i.discount_per_unit > 0 && <small className="muted"> ({t('product.sale')} −{money(i.discount_per_unit)})</small>}</td>
                  <td>× {i.quantity}</td><td>{money(i.line_total)}</td>
                </tr>))}</tbody>
            </table></div>
            <div className="summary">
              <p className="row"><span>{t('cart.subtotal')}</span><strong>{money(o.subtotal)}</strong></p>
              {o.coupon_discount > 0 && <p className="row"><span>{t('checkout.couponDiscount')}</span><strong>−{money(o.coupon_discount)}</strong></p>}
              <p className="row"><span>{t('checkout.shipping')}</span><strong>{money(o.shipping_fee)}</strong></p>
              <p className="row total"><span>{t('checkout.total')}</span><strong>{money(o.total)}</strong></p>
            </div>

            <section>
              <h2>{t('admin.orders.changeStatus')}</h2>
              {next.length === 0 ? <p className="muted">{t('admin.orders.noNext')}</p> : (
                <>
                  <Field label={t('admin.orders.note')} htmlFor="note"><input id="note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
                  <div className="row">{next.map((s) => <button key={s} className="btn" onClick={() => change(s)}>{t(`status.${s}`)}</button>)}</div>
                </>
              )}
              {msg && <p className="bad" role="alert">{msg}</p>}
            </section>

            <h2>{t('admin.orders.history')}</h2>
            <Async state={hist}>
              {(h) => (
                <ul className="history">
                  {h.map((r) => (
                    <li key={r.id}>
                      {r.from_status ? <>{t(`status.${r.from_status}`)} → </> : null}<strong>{t(`status.${r.to_status}`)}</strong>{' '}
                      <span className="muted">{fmt(r.created_at)}{!r.changed_by && ` · ${t('admin.orders.system')}`}</span>
                      {r.note && <div className="muted">“{r.note}”</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Async>
          </>
        );
      }}
    </Async>
  );
}

export function Shipping() {
  const { t, money } = useSettings();
  const state = useAsync(adminShipping, []);
  const [draft, setDraft] = useState({ city: '', fee: '' });
  const [msg, setMsg] = useState(null);
  const run = async (fn) => { setMsg(null); try { await fn(); state.reload(); } catch (e) { setMsg(t(errorKey(e))); } };
  return (
    <>
      <h1>{t('admin.nav.shipping')}</h1>
      {msg && <p className="bad" role="alert">{msg}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>{t('admin.ship.city')}</th><th>{t('admin.ship.fee')}</th><th>{t('common.active')}</th><th>{t('common.actions')}</th></tr></thead>
        <tbody>
          {(state.data || []).map((r) => <RateRow key={r.id} r={r} onSave={(v) => run(() => saveShipping(v))} onDelete={() => window.confirm(t('common.confirmDelete')) && run(() => deleteShipping(r.id))} />)}
          <tr>
            <td><input aria-label={t('admin.ship.city')} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} maxLength={60} /></td>
            <td><input aria-label={t('admin.ship.fee')} type="number" min="0" step="0.01" value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} /></td>
            <td></td>
            <td><button className="btn btn-primary" onClick={() => run(async () => { await saveShipping(draft); setDraft({ city: '', fee: '' }); })}>{t('common.add')}</button></td>
          </tr>
        </tbody>
      </table></div>
      <p className="muted">{t('admin.ship.default')} · {money(state.data?.find((r) => r.is_default)?.fee ?? 0)}</p>
    </>
  );
}
function RateRow({ r, onSave, onDelete }) {
  const { t } = useSettings();
  const [v, setV] = useState(r);
  return (
    <tr>
      <td>{r.is_default ? <em>{t('admin.ship.default')}</em> : <input aria-label={t('admin.ship.city')} value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} maxLength={60} />}</td>
      <td><input aria-label={t('admin.ship.fee')} type="number" min="0" step="0.01" value={v.fee} onChange={(e) => setV({ ...v, fee: e.target.value })} /></td>
      <td><input type="checkbox" aria-label={t('common.active')} checked={v.is_active} disabled={r.is_default} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /></td>
      <td className="actions"><button className="btn" onClick={() => onSave(v)}>{t('common.save')}</button>{!r.is_default && <button className="btn btn-ghost" onClick={onDelete}>{t('common.delete')}</button>}</td>
    </tr>
  );
}

export function Settings() {
  const { t, lang, setLang, theme, setTheme } = useSettings();
  const [pw, setPw] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const savePw = async (e) => {
    e.preventDefault(); setPwMsg(null);
    if (pw.length < 10) { setPwMsg({ bad: true, text: t('admin.pw.short') }); return; }
    try { await updatePassword(pw); setPw(''); setPwMsg({ bad: false, text: t('common.saved') }); } catch (err) { setPwMsg({ bad: true, text: t(errorKey(err)) }); }
  };
  return (
    <>
      <h1>{t('admin.nav.settings')}</h1>
      <div className="two">
        <Field label={t('admin.settings.lang')} htmlFor="lg">
          <select id="lg" value={lang} onChange={(e) => setLang(e.target.value)}><option value="ar">العربية</option><option value="fr">Français</option></select>
        </Field>
        <Field label={t('admin.settings.theme')} htmlFor="th">
          <select id="th" value={theme} onChange={(e) => setTheme(e.target.value)}><option value="dark">{t('theme.dark')}</option><option value="light">{t('theme.light')}</option></select>
        </Field>
      </div>
      <p className="muted">{t('admin.settings.note')}</p>
      <form onSubmit={savePw} className="admin-form">
        <h2>{t('admin.pw.title')}</h2>
        <Field label={t('admin.pw.new')} htmlFor="newpw"><input id="newpw" type="password" autoComplete="new-password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {pwMsg && <p className={pwMsg.bad ? 'bad' : 'ok'} role="status">{pwMsg.text}</p>}
        <button className="btn">{t('common.save')}</button>
      </form>
    </>
  );
}
