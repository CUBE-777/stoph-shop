import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Async, Field } from '../components/ui.jsx';
import { errorKey } from '../lib/supabase.js';
import { RETURN_REASONS, RETURN_STATUSES, canCancelOrder, canRegisterReturn, canReturnTransition, validateReason } from '../lib/shop.js';
import { useAdmin } from './context.js';
import { RETURNS_PAGE, adminReturns, cancelOrder, orderReturns, registerReturn, updateReturn } from '../services/admin.js';

const useFmt = () => {
  const { lang } = useSettings();
  return (d) => (d ? new Date(d).toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA', { dateStyle: 'short', timeStyle: 'short' }) : '—');
};

// Cancel / register-return forms shown on the order page. The server re-checks permission, status and reason.
export function CancelReturnPanel({ order, onChanged }) {
  const { t } = useSettings();
  const { can } = useAdmin();
  const [mode, setMode] = useState(null);       // 'cancel' | 'return'
  const [f, setF] = useState({ reason: 'customer_changed_mind', note: '', received: false });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!can('orders.cancel')) return null;
  const showCancel = canCancelOrder(order.status);
  const showReturn = canRegisterReturn(order.status);
  if (!showCancel && !showReturn) return null;

  const submit = async (e) => {
    e.preventDefault();
    const bad = validateReason(f.reason, f.note);
    if (bad) { setMsg(t(`err.${bad}`)); return; }
    setBusy(true); setMsg(null);
    try {
      if (mode === 'cancel') await cancelOrder(order.id, f.reason, f.note);
      else await registerReturn(order.id, f.reason, f.note, f.received);
      setMode(null); setF({ reason: 'customer_changed_mind', note: '', received: false }); onChanged();
    } catch (err) { setMsg(t(errorKey(err))); } finally { setBusy(false); }
  };

  return (
    <section>
      <h2>{t('ret.panelTitle')}</h2>
      {!mode && (
        <div className="row">
          {showCancel && <button className="btn" onClick={() => setMode('cancel')}>{t('ret.cancelOrder')}</button>}
          {showReturn && <button className="btn" onClick={() => setMode('return')}>{t('ret.registerReturn')}</button>}
        </div>
      )}
      {mode && (
        <form onSubmit={submit} className="admin-form" noValidate>
          <h3>{mode === 'cancel' ? t('ret.cancelOrder') : t('ret.registerReturn')}</h3>
          <Field label={t('ret.reason')} htmlFor="ret-reason">
            <select id="ret-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
              {RETURN_REASONS.map((r) => <option key={r} value={r}>{t(`ret.reason.${r}`)}</option>)}
            </select>
          </Field>
          <Field label={t('ret.note')} htmlFor="ret-note" hint={f.reason === 'other' ? t('ret.noteRequired') : undefined}>
            <textarea id="ret-note" rows="2" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          {mode === 'return' && (
            <label className="inline"><input type="checkbox" checked={f.received} onChange={(e) => setF({ ...f, received: e.target.checked })} /> {t('ret.alreadyReceived')}</label>
          )}
          <p className="muted">{mode === 'cancel' ? t('ret.cancelWarn') : t('ret.returnWarn')}</p>
          {msg && <p className="bad" role="alert">{msg}</p>}
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>{t('common.save')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setMode(null); setMsg(null); }}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </section>
  );
}

// Records already attached to one order, with the follow-up actions for open returns.
export function OrderReturnsList({ orderId, reloadKey, onChanged }) {
  const { t } = useSettings();
  const { can } = useAdmin();
  const fmt = useFmt();
  const state = useAsync(() => orderReturns(orderId), [orderId, reloadKey]);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState(null);
  const act = async (id, status) => {
    setMsg(null);
    try { await updateReturn(id, status, notes); setNotes(''); state.reload(); onChanged?.(); } catch (e) { setMsg(t(errorKey(e))); }
  };
  return (
    <Async state={state} isEmpty={(d) => d.length === 0} empty="">
      {(d) => d.length === 0 ? null : (
        <section>
          <h2>{t('ret.recordsTitle')}</h2>
          <ul className="history">
            {d.map((r) => (
              <li key={r.id}>
                <strong>{t(`ret.kind.${r.kind}`)}</strong> · <span className={`pill st-ret-${r.status}`}>{t(`ret.status.${r.status}`)}</span> · {t(`ret.reason.${r.reason_code}`)}
                <div className="muted">{fmt(r.requested_at)} · {t('ret.handledBy')}: {r.handled_by_name || '—'}</div>
                {r.reason_note && <div className="muted">“{r.reason_note}”</div>}
                {r.admin_notes && <div className="muted">{t('ret.adminNotes')}: {r.admin_notes}</div>}
                {r.kind === 'return' && can('orders.cancel') && ['requested', 'approved'].includes(r.status) && (
                  <div className="row">
                    <input aria-label={t('ret.adminNotes')} placeholder={t('ret.adminNotes')} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    {RETURN_STATUSES.filter((s) => canReturnTransition(r.status, s)).map((s) => <button key={s} className="btn" onClick={() => act(r.id, s)}>{t(`ret.action.${s}`)}</button>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {msg && <p className="bad" role="alert">{msg}</p>}
        </section>
      )}
    </Async>
  );
}

export function Returns() {
  const { t, money } = useSettings();
  const fmt = useFmt();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const state = useAsync(() => adminReturns(status, page), [status, page]);
  return (
    <>
      <h1>{t('admin.nav.returns')}</h1>
      <div className="filters">
        <Field label={t('admin.orders.filter')} htmlFor="rs">
          <select id="rs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="">{t('common.all')}</option>
            {RETURN_STATUSES.map((s) => <option key={s} value={s}>{t(`ret.status.${s}`)}</option>)}
          </select>
        </Field>
      </div>
      <p className="muted">{t('ret.listNote')}</p>
      <Async state={state} empty={t('ret.empty')} isEmpty={(d) => d.rows.length === 0}>
        {({ rows, total }) => (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>{t('admin.orders.number')}</th><th>{t('ret.type')}</th><th>{t('ret.reason')}</th><th>{t('ret.orderDate')}</th><th>{t('ret.returnDate')}</th><th>{t('ret.statusCol')}</th><th>{t('ret.handledBy')}</th><th>{t('checkout.total')}</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td dir="ltr"><Link to={`/admin/orders/${r.order_id}`}>#{r.order_number}</Link><br /><small>{r.customer_name}</small></td>
                  <td>{t(`ret.kind.${r.kind}`)}</td><td>{t(`ret.reason.${r.reason_code}`)}</td>
                  <td>{fmt(r.order_created_at)}</td><td>{fmt(r.requested_at)}</td>
                  <td><span className={`pill st-ret-${r.status}`}>{t(`ret.status.${r.status}`)}</span></td>
                  <td>{r.handled_by_name || '—'}</td><td>{money(r.order_total)}</td>
                </tr>))}</tbody>
            </table></div>
            <Pager page={page} total={total} size={RETURNS_PAGE} onPage={setPage} />
          </>
        )}
      </Async>
    </>
  );
}

export function Pager({ page, total, size, onPage }) {
  const { t } = useSettings();
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav className="row pager" aria-label={t('common.pages')}>
      <button className="btn" disabled={page <= 0} onClick={() => onPage(page - 1)}>{t('common.prev')}</button>
      <span aria-live="polite">{page + 1} / {pages} · {total}</span>
      <button className="btn" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>{t('common.next')}</button>
    </nav>
  );
}
