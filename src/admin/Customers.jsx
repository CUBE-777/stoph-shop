import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Async, Field } from '../components/ui.jsx';
import { errorKey } from '../lib/supabase.js';
import { useAdmin } from './context.js';
import { adminCustomer, adminCustomers, customerOrders, sharedPhoneCustomers, updateCustomer } from '../services/admin.js';

export function Customers() {
  const { t, lang, money } = useSettings();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const state = useAsync(() => adminCustomers(search), [search]);
  const fmt = (d) => (d ? new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA') : '—');
  return (
    <>
      <h1>{t('admin.nav.customers')}</h1>
      <form className="filters" role="search" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <Field label={t('admin.cust.search')} htmlFor="cq"><input id="cq" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} /></Field>
        <button className="btn btn-primary">{t('common.search')}</button>
      </form>
      <Async state={state} empty={t('admin.cust.empty')} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('admin.f.nameFr')}</th><th>{t('admin.orders.phone')}</th><th>{t('admin.cust.orders')}</th><th>{t('admin.cust.last')}</th><th>{t('admin.cust.spent')}</th><th></th></tr></thead>
            <tbody>{d.map((c) => (
              <tr key={c.id}>
                <td>{c.full_name}</td><td dir="ltr">{c.phone}</td><td>{c.orders_count}</td><td>{fmt(c.last_order_at)}</td>
                <td>{money(c.delivered_total)}</td><td><Link className="btn" to={`/admin/customers/${c.id}`}>{t('admin.cust.history')}</Link></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Async>
    </>
  );
}

export function CustomerDetail() {
  const { id } = useParams();
  const { t, lang, money } = useSettings();
  const { can } = useAdmin();
  const cust = useAsync(() => adminCustomer(id), [id]);
  const shared = useAsync(() => (cust.data ? sharedPhoneCustomers(cust.data.phone, id) : Promise.resolve([])), [cust.data?.phone, id]);
  const orders = useAsync(() => (can('orders.view') ? customerOrders(id) : Promise.resolve(null)), [id]);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const fmt = (d) => new Date(d).toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA', { dateStyle: 'short', timeStyle: 'short' });

  const save = async (e) => {
    e.preventDefault(); setMsg(null);
    try { await updateCustomer(id, form); setMsg({ bad: false, text: t('common.saved') }); cust.reload(); } catch (err) { setMsg({ bad: true, text: t(errorKey(err)) }); }
  };
  return (
    <>
      <p><Link to="/admin/customers">← {t('common.back')}</Link></p>
      <Async state={cust}>
        {(c) => {
          const f = form || { full_name: c.full_name, staff_notes: c.staff_notes || '' };
          return (
            <>
              <h1>{c.full_name} <small dir="ltr" className="muted">{c.phone}</small></h1>
              {can('customers.update') ? (
                <form onSubmit={save} className="admin-form">
                  <Field label={t('admin.f.nameFr')} htmlFor="cn"><input id="cn" value={f.full_name} maxLength={100} onChange={(e) => setForm({ ...f, full_name: e.target.value })} required /></Field>
                  <Field label={t('admin.cust.notes')} htmlFor="cnotes"><textarea id="cnotes" rows="3" value={f.staff_notes} maxLength={1000} onChange={(e) => setForm({ ...f, staff_notes: e.target.value })} /></Field>
                  {msg && <p className={msg.bad ? 'bad' : 'ok'} role="status">{msg.text}</p>}
                  <button className="btn btn-primary">{t('common.save')}</button>
                </form>
              ) : c.staff_notes && <p><strong>{t('admin.cust.notes')}:</strong> {c.staff_notes}</p>}

              {shared.data?.length > 0 && (
                <><h2>{t('admin.cust.sharedPhone')}</h2>
                  <ul>{shared.data.map((o) => <li key={o.id}><Link to={`/admin/customers/${o.id}`}>{o.full_name}</Link></li>)}</ul></>
              )}

              <h2>{t('admin.cust.history')}</h2>
              <Async state={orders} empty={t('admin.cust.needOrders')} isEmpty={(d) => d === null}>
                {(d) => d.length === 0 ? <p className="state">{t('admin.orders.empty')}</p> : (
                  <div className="table-wrap"><table><tbody>{d.map((o) => (
                    <tr key={o.id}>
                      <td dir="ltr"><Link to={`/admin/orders/${o.id}`}>#{o.order_number}</Link></td><td>{o.city}</td>
                      <td>{money(o.total)}</td><td>{fmt(o.created_at)}</td><td><span className={`pill st-${o.status}`}>{t(`status.${o.status}`)}</span></td>
                    </tr>))}</tbody></table></div>
                )}
              </Async>
            </>
          );
        }}
      </Async>
    </>
  );
}
