import { useState } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Async, Field } from '../components/ui.jsx';
import { errorKey } from '../lib/supabase.js';
import { useAdmin } from './context.js';
import {
  auditLogs, createRole, inviteStaff, isOwner, listRoles, listStaff, registerStaff, setRolePermissions, setStaffActive, setStaffRoles,
} from '../services/admin.js';

export function Staff() {
  const { t } = useSettings();
  const { userId } = useAdmin();
  const staff = useAsync(listStaff, []);
  const roles = useAsync(listRoles, []);
  const owner = useAsync(isOwner, []);
  const [msg, setMsg] = useState(null);
  const [add, setAdd] = useState({ email: '', name: '', roleIds: [] });

  const run = async (fn) => { setMsg(null); try { await fn(); staff.reload(); roles.reload(); } catch (e) { setMsg(t(errorKey(e))); } };
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <>
      <h1>{t('admin.nav.staff')}</h1>
      {msg && <p className="bad" role="alert">{msg}</p>}
      <Async state={roles}>
        {(r) => (
          <>
            <Async state={staff}>
              {(list) => (
                <div className="table-wrap"><table>
                  <thead><tr><th>Email</th><th>{t('admin.staff.name')}</th><th>{t('admin.staff.roles')}</th><th>{t('admin.staff.active')}</th></tr></thead>
                  <tbody>{list.map((s) => {
                    const self = s.user_id === userId;
                    return (
                      <tr key={s.user_id}>
                        <td dir="ltr">{s.email}{self && <small className="muted"> — {t('admin.staff.self')}</small>}</td>
                        <td>{s.full_name}</td>
                        <td>{r.roles.map((role) => (
                          <label key={role.id} className="inline"><input type="checkbox" disabled={self} checked={s.role_ids.includes(role.id)}
                            onChange={() => run(() => setStaffRoles(s.user_id, toggle(s.role_ids, role.id)))} /> {role.name}&nbsp;&nbsp;</label>))}</td>
                        <td><input type="checkbox" aria-label={t('admin.staff.active')} disabled={self} checked={s.is_active} onChange={(e) => run(() => setStaffActive(s.user_id, e.target.checked))} /></td>
                      </tr>);
                  })}</tbody>
                </table></div>
              )}
            </Async>

            <h2>{t('admin.staff.add')}</h2>
            <p className="muted">{t('admin.staff.addHelp')}</p>
            <form className="admin-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await registerStaff(add.email, add.name, add.roleIds); setAdd({ email: '', name: '', roleIds: [] }); }); }}>
              <div className="two">
                <Field label="Email" htmlFor="se"><input id="se" type="email" dir="ltr" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} required /></Field>
                <Field label={t('admin.staff.name')} htmlFor="sn"><input id="sn" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
              </div>
              <div className="checks">{r.roles.map((role) => (
                <label key={role.id}><input type="checkbox" checked={add.roleIds.includes(role.id)} onChange={() => setAdd({ ...add, roleIds: toggle(add.roleIds, role.id) })} /> {role.name}</label>))}</div>
              <div className="row">
                <button className="btn btn-primary">{t('admin.staff.add')}</button>
                <button type="button" className="btn" onClick={() => run(async () => { await inviteStaff(add.email, add.name, add.roleIds); setAdd({ email: '', name: '', roleIds: [] }); })}>{t('admin.staff.invite')}</button>
              </div>
            </form>

            <h2>{t('admin.staff.rolesTitle')}</h2>
            {!owner.data && <p className="muted">{t('admin.staff.ownerOnly')}</p>}
            {r.roles.map((role) => {
              const granted = new Set(r.links.filter((l) => l.role_id === role.id).map((l) => r.perms.find((p) => p.id === l.permission_id)?.key));
              const locked = !owner.data || role.key === 'owner';
              return (
                <fieldset key={role.id}><legend>{role.name} <small className="muted" dir="ltr">({role.key})</small></legend>
                  <div className="perm-grid">{r.perms.map((p) => (
                    <label key={p.id} title={p.description}><input type="checkbox" disabled={locked} checked={granted.has(p.key)}
                      onChange={() => run(() => setRolePermissions(role.id, [...(granted.has(p.key) ? [...granted].filter((k) => k !== p.key) : [...granted, p.key])]))} /> <span dir="ltr">{p.key}</span></label>))}</div>
                </fieldset>
              );
            })}
            {owner.data && <NewRole onCreate={(k, n) => run(() => createRole(k, n))} />}
          </>
        )}
      </Async>
    </>
  );
}

function NewRole({ onCreate }) {
  const { t } = useSettings();
  const [k, setK] = useState('');
  const [n, setN] = useState('');
  return (
    <form className="filters" onSubmit={(e) => { e.preventDefault(); onCreate(k.trim(), n.trim()); setK(''); setN(''); }}>
      <Field label={t('admin.staff.roleKey')} htmlFor="rk"><input id="rk" dir="ltr" value={k} onChange={(e) => setK(e.target.value.toLowerCase())} maxLength={31} required /></Field>
      <Field label={t('admin.staff.roleName')} htmlFor="rn"><input id="rn" value={n} onChange={(e) => setN(e.target.value)} maxLength={60} required /></Field>
      <button className="btn">{t('admin.staff.newRole')}</button>
    </form>
  );
}

export function Audit() {
  const { t, lang } = useSettings();
  const state = useAsync(auditLogs, []);
  const fmt = (d) => new Date(d).toLocaleString(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA', { dateStyle: 'short', timeStyle: 'medium' });
  return (
    <>
      <h1>{t('admin.nav.audit')}</h1>
      <Async state={state} empty={t('admin.audit.empty')} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <div className="table-wrap"><table>
            <thead><tr><th>{t('admin.audit.when')}</th><th>{t('admin.audit.actor')}</th><th>{t('admin.audit.action')}</th><th>{t('admin.audit.entity')}</th></tr></thead>
            <tbody>{d.map((a) => (
              <tr key={a.id}>
                <td>{fmt(a.created_at)}</td><td dir="ltr"><small>{a.actor_id ? a.actor_id.slice(0, 8) : '—'}</small></td>
                <td>{a.action}</td>
                <td>{a.entity} <details><summary dir="ltr">{a.entity_id?.slice(0, 8)}</summary><pre dir="ltr" className="muted">{JSON.stringify(a.details, null, 1)}</pre></details></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Async>
    </>
  );
}
