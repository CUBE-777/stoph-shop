import { useState } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Async, Field } from '../components/ui.jsx';
import { errorKey } from '../lib/supabase.js';
import { ORDER_STATUSES } from '../lib/shop.js';
import { adminCoupons, adminReport, deleteCoupon, saveCoupon } from '../services/admin.js';

const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const NEW_COUPON = { code: '', description: '', discount_type: 'percent', value: '', max_discount: '', min_order: 0, starts_at: '', ends_at: '', max_uses: '', one_per_phone: false, is_active: true };

export function Coupons() {
  const { t, money } = useSettings();
  const state = useAsync(adminCoupons, []);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const edit = (c) => setForm({ ...c, starts_at: toLocalInput(c.starts_at), ends_at: toLocalInput(c.ends_at), max_discount: c.max_discount ?? '', max_uses: c.max_uses ?? '' });

  const save = async (e) => {
    e.preventDefault(); setMsg(null);
    try { await saveCoupon(form); setForm(null); state.reload(); } catch (err) { setMsg(t(errorKey(err)) === t('err.generic') ? t('err.invalid') : t(errorKey(err))); }
  };
  const remove = async (c) => {
    if (!window.confirm(t('common.confirmDelete'))) return;
    try { await deleteCoupon(c.id); state.reload(); } catch (err) { setMsg(t(errorKey(err))); }
  };
  return (
    <>
      <div className="row"><h1>{t('admin.nav.coupons')}</h1>{!form && <button className="btn btn-primary" onClick={() => setForm({ ...NEW_COUPON })}>{t('admin.coupon.new')}</button>}</div>
      {form && (
        <form onSubmit={save} className="admin-form" noValidate>
          <div className="two">
            <Field label={t('admin.coupon.code')} htmlFor="cc"><input id="cc" dir="ltr" value={form.code} maxLength={32} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required /></Field>
            <Field label={t('admin.coupon.desc')} htmlFor="cd"><input id="cd" value={form.description || ''} onChange={set('description')} /></Field>
            <Field label={t('admin.coupon.type')} htmlFor="ct"><select id="ct" value={form.discount_type} onChange={set('discount_type')}>
              <option value="percent">{t('admin.coupon.percent')}</option><option value="fixed">{t('admin.coupon.fixed')}</option></select></Field>
            <Field label={t('admin.coupon.value')} htmlFor="cv"><input id="cv" type="number" min="0" step="0.01" value={form.value} onChange={set('value')} required /></Field>
            {form.discount_type === 'percent' && <Field label={t('admin.coupon.max')} htmlFor="cm"><input id="cm" type="number" min="0" step="0.01" value={form.max_discount} onChange={set('max_discount')} /></Field>}
            <Field label={t('admin.coupon.min')} htmlFor="cmin"><input id="cmin" type="number" min="0" step="0.01" value={form.min_order} onChange={set('min_order')} /></Field>
            <Field label={t('admin.coupon.start')} htmlFor="cs"><input id="cs" type="datetime-local" value={form.starts_at} onChange={set('starts_at')} /></Field>
            <Field label={t('admin.coupon.end')} htmlFor="ce"><input id="ce" type="datetime-local" value={form.ends_at} onChange={set('ends_at')} /></Field>
            <Field label={t('admin.coupon.uses')} htmlFor="cu"><input id="cu" type="number" min="1" step="1" value={form.max_uses} onChange={set('max_uses')} /></Field>
          </div>
          <div className="checks">
            <label><input type="checkbox" checked={form.one_per_phone} onChange={set('one_per_phone')} /> {t('admin.coupon.onePerPhone')}</label>
            <label><input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> {t('common.active')}</label>
          </div>
          {msg && <p className="bad" role="alert">{msg}</p>}
          <div className="row"><button className="btn btn-primary">{t('common.save')}</button><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>{t('common.cancel')}</button></div>
        </form>
      )}
      {!form && msg && <p className="bad" role="alert">{msg}</p>}
      <Async state={state} empty={t('admin.coupon.empty')} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('admin.coupon.code')}</th><th>{t('admin.coupon.value')}</th><th>{t('admin.coupon.min')}</th><th>{t('admin.coupon.used')}</th><th>{t('common.active')}</th><th>{t('common.actions')}</th></tr></thead>
            <tbody>{d.map((c) => (
              <tr key={c.id}>
                <td dir="ltr"><strong>{c.code}</strong></td>
                <td>{c.discount_type === 'percent' ? `${c.value}%${c.max_discount ? ` (≤ ${money(c.max_discount)})` : ''}` : money(c.value)}</td>
                <td>{money(c.min_order)}</td><td>{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                <td>{c.is_active ? t('common.yes') : t('common.no')}</td>
                <td className="actions"><button className="btn" onClick={() => edit(c)}>{t('common.edit')}</button><button className="btn btn-ghost" onClick={() => remove(c)}>{t('common.delete')}</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Async>
    </>
  );
}

const iso = (d) => d.toISOString().slice(0, 10);
export function Reports() {
  const { t, money } = useSettings();
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 29 * 86400000)));
  const [to, setTo] = useState(iso(today));
  const [range, setRange] = useState({ from, to });
  const state = useAsync(() => adminReport(range.from, range.to), [range.from, range.to]);
  return (
    <>
      <h1>{t('admin.nav.reports')}</h1>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setRange({ from, to }); }}>
        <Field label={t('admin.rep.from')} htmlFor="rf"><input id="rf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('admin.rep.to')} htmlFor="rt"><input id="rt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <button className="btn btn-primary">{t('admin.rep.run')}</button>
      </form>
      <p className="muted">{t('admin.rep.rules')}</p>
      <Async state={state}>
        {(r) => {
          const maxDay = Math.max(1, ...r.by_day.map((d) => d.orders));
          return (
            <>
              <div className="stats">
                <div className="stat"><strong>{r.orders_total}</strong><span>{t('admin.rep.total')}</span></div>
                <div className="stat"><strong>{money(r.sales.amount)}</strong><span>{t('admin.rep.sales')} · {r.sales.count}</span></div>
                <div className="stat"><strong>{r.cancelled.count}</strong><span>{t('admin.rep.cancelled')} · {money(r.cancelled.amount)}</span></div>
                <div className="stat"><strong>{r.returned.count}</strong><span>{t('admin.rep.returned')} · {money(r.returned.amount)}</span></div>
              </div>
              <h2>{t('admin.dash.byStatus')}</h2>
              <ul className="status-list">{ORDER_STATUSES.map((s) => <li key={s}><span>{t(`status.${s}`)}</span><strong>{r.by_status[s] || 0}</strong></li>)}</ul>
              <h2>{t('admin.rep.top')}</h2>
              <div className="table-wrap"><table>
                <thead><tr><th></th><th>{t('admin.rep.qty')}</th><th>{t('admin.rep.amount')}</th></tr></thead>
                <tbody>{r.top_products.map((p, i) => <tr key={i}><td>{p.name_fr || p.name_ar}</td><td>{p.quantity}</td><td>{money(p.amount)}</td></tr>)}</tbody>
              </table></div>
              <h2>{t('admin.rep.cities')}</h2>
              <div className="table-wrap"><table>
                <thead><tr><th></th><th>{t('admin.rep.ordersCol')}</th><th>{t('admin.rep.sales')}</th></tr></thead>
                <tbody>{r.by_city.map((c, i) => <tr key={i}><td>{c.city}</td><td>{c.orders}</td><td>{money(c.sales)}</td></tr>)}</tbody>
              </table></div>
              <h2>{t('admin.rep.days')}</h2>
              <div className="bars">{r.by_day.map((d) => (
                <div className="bar-row" key={d.day}><span dir="ltr">{d.day}</span>
                  <span className="bar-fill" style={{ width: `${(d.orders / maxDay) * 100}%` }} role="img" aria-label={`${d.orders}`} />
                  <span>{d.orders} · {money(d.sales)}</span></div>))}</div>
            </>
          );
        }}
      </Async>
    </>
  );
}
