// Admin > Banners: manage the storefront promotional carousel. Every write is checked by the database
// (RLS + banners.manage); hiding this screen from other roles is only a convenience.
import { useEffect, useMemo, useState } from 'react';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Async, Field } from '../components/ui.jsx';
import HeroCarousel from '../components/HeroCarousel.jsx';
import { errorKey } from '../lib/supabase.js';
import {
  BANNER_SIZES, CAROUSEL_DEFAULTS, bannerStatus, bannerText, fromLocalInput, toLocalInput, validateBanner, validateImageFile,
} from '../lib/shop.js';
import {
  adminCategories, bannerImageUrl, deleteBanner, getCarouselSettingsAdmin, listBannersAdmin, listProductsLite, moveBanner,
  saveBanner, saveCarouselSettings, setBannerActive,
} from '../services/admin.js';

const EMPTY = {
  title_ar: '', title_fr: '', subtitle_ar: '', subtitle_fr: '', button_ar: '', button_fr: '', link_type: 'none',
  product_id: '', category_id: '', page_path: '/products', link_url: '', image_path: null, mobile_image_path: null,
  image_alt_ar: '', image_alt_fr: '', starts_at: null, ends_at: null, is_active: false, sort_order: 0,
};
const PAGES = ['/', '/products', '/track', '/delivery', '/contact'];

function useObjectUrl(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => { if (!file) { setUrl(null); return undefined; } const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  return url;
}

export function Banners() {
  const { t, lang } = useSettings();
  const list = useAsync(listBannersAdmin, []);
  const settings = useAsync(getCarouselSettingsAdmin, []);
  const [editing, setEditing] = useState(null);       // null | banner object (id undefined = new)
  const [msg, setMsg] = useState(null);                // { bad, text }
  const say = (text, bad = false) => setMsg({ text, bad });
  const run = async (fn, okText) => { setMsg(null); try { await fn(); if (okText) say(okText); list.reload(); } catch (e) { say(t(errorKey(e)), true); } };
  const status = (b) => bannerStatus(b);

  if (editing) return <BannerForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); say(t('banners.saved')); list.reload(); }} />;

  return (
    <>
      <div className="row"><h1>{t('banners.title')}</h1><button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY, sort_order: ((list.data?.length || 0) + 1) * 10 })}>{t('banners.new')}</button></div>
      <p className="muted">{t('banners.help')}</p>
      {msg && <p className={msg.bad ? 'bad' : 'ok'} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}

      <Async state={list} empty={t('banners.empty')} isEmpty={(d) => d.length === 0}>
        {(rows) => (
          <div className="table-wrap"><table>
            <caption className="sr">{t('banners.title')}</caption>
            <thead><tr><th>{t('banners.image')}</th><th>{t('banners.bannerTitle')}</th><th>{t('banners.statusCol')}</th><th>{t('banners.schedule')}</th><th>{t('banners.order')}</th><th>{t('banners.actions')}</th></tr></thead>
            <tbody>{rows.map((b, i) => (
              <tr key={b.id}>
                <td>{b.image_path ? <img className="thumb thumb-wide" src={bannerImageUrl(b.image_path)} alt="" loading="lazy" width="96" height="36" /> : <span className="muted">—</span>}</td>
                <td><strong>{bannerText(b, 'title', lang)}</strong><br /><small className="muted">{t(`banners.link.${b.link_type}`)}</small></td>
                <td><span className={`pill bs-${status(b)}`}>{t(`banners.status.${status(b)}`)}</span></td>
                <td><small>{b.starts_at ? new Date(b.starts_at).toLocaleString() : '—'}<br />{b.ends_at ? new Date(b.ends_at).toLocaleString() : '—'}</small></td>
                <td className="actions">
                  <button type="button" className="btn btn-ghost" disabled={i === 0} onClick={() => run(() => moveBanner(rows, b.id, -1))} aria-label={`${t('banners.up')}: ${bannerText(b, 'title', lang)}`}>↑</button>
                  <button type="button" className="btn btn-ghost" disabled={i === rows.length - 1} onClick={() => run(() => moveBanner(rows, b.id, 1))} aria-label={`${t('banners.down')}: ${bannerText(b, 'title', lang)}`}>↓</button>
                </td>
                <td className="actions">
                  <label className="inline"><input type="checkbox" checked={b.is_active} onChange={(e) => run(() => setBannerActive(b.id, e.target.checked))} /> {t('banners.enabled')}</label>{' '}
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(b)}>{t('common.edit')}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => window.confirm(t('banners.deleteConfirm')) && run(() => deleteBanner(b), t('banners.deleted'))}>{t('common.delete')}</button>
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Async>

      <CarouselSettings state={settings} say={say} />
    </>
  );
}

function CarouselSettings({ state, say }) {
  const { t } = useSettings();
  const [s, setS] = useState(CAROUSEL_DEFAULTS);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (state.data) setS({ ...CAROUSEL_DEFAULTS, ...state.data }); }, [state.data]);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await saveCarouselSettings(s); say(t('banners.settingsSaved')); } catch (err) { say(t(errorKey(err)), true); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="admin-form">
      <h2>{t('banners.settings')}</h2>
      <label className="inline"><input type="checkbox" checked={s.autoplay} onChange={(e) => setS({ ...s, autoplay: e.target.checked })} /> {t('banners.autoplay')}</label>
      <div className="two">
        <Field label={`${t('banners.interval')} (3–15)`} htmlFor="cs-int"><input id="cs-int" type="number" min="3" max="15" value={s.interval_seconds} onChange={(e) => setS({ ...s, interval_seconds: e.target.value })} /></Field>
        <Field label={t('banners.transition')} htmlFor="cs-tr">
          <select id="cs-tr" value={s.transition} onChange={(e) => setS({ ...s, transition: e.target.value })}>
            <option value="slide">{t('banners.tr.slide')}</option><option value="fade">{t('banners.tr.fade')}</option>
          </select>
        </Field>
      </div>
      <p className="muted">{t('banners.settingsNote')}</p>
      <button className="btn" disabled={busy}>{busy ? t('common.loading') : t('common.save')}</button>
    </form>
  );
}

function BannerForm({ initial, onClose, onSaved }) {
  const { t } = useSettings();
  const [b, setB] = useState(initial);
  const [files, setFiles] = useState({ desktop: null, mobile: null });
  const [removeMobile, setRemoveMobile] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({});
  const [submitErr, setSubmitErr] = useState(null);
  const [view, setView] = useState('desktop');
  const cats = useAsync(adminCategories, []);
  const prods = useAsync(listProductsLite, []);
  const dUrl = useObjectUrl(files.desktop);
  const mUrl = useObjectUrl(files.mobile);
  const set = (k) => (e) => setB({ ...b, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const pick = (kind) => (e) => {
    const f = e.target.files?.[0] || null;
    const bad = validateImageFile(f);
    if (bad) { setErrors((x) => ({ ...x, [kind === 'desktop' ? 'image' : 'mobile']: bad })); e.target.value = ''; return; }
    setErrors((x) => { const n = { ...x }; delete n[kind === 'desktop' ? 'image' : 'mobile']; return n; });
    setFiles((x) => ({ ...x, [kind]: f }));
    if (kind === 'mobile') setRemoveMobile(false);
  };

  // What visitors would see: the same carousel component, fed with the draft (selected files shown straight from memory).
  const previewBanner = useMemo(() => ({
    ...b, id: 'preview', is_active: true, _view: view,
    _imageUrl: dUrl || (b.image_path ? bannerImageUrl(b.image_path) : null),
    _mobileUrl: removeMobile ? null : mUrl || (b.mobile_image_path ? bannerImageUrl(b.mobile_image_path) : null),
    products: prods.data?.find((p) => p.id === b.product_id) || null,
    categories: cats.data?.find((c) => c.id === b.category_id) || null,
  }), [b, dUrl, mUrl, view, removeMobile, prods.data, cats.data]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const errs = validateBanner(b, { hasImage: !!(files.desktop || b.image_path) });
    setErrors(errs); setSubmitErr(null);
    if (Object.keys(errs).length) return;
    setBusy(true); setProgress({});
    try {
      await saveBanner(b, files, { removeMobile, onProgress: (k, p) => setProgress((x) => ({ ...x, [k]: p })) });
      onSaved();
    } catch (err) { setSubmitErr(t(errorKey(err))); } finally { setBusy(false); }
  };

  const txt = (k, label, props = {}) => (
    <Field label={label} error={errors[k] && t(errors[k])} htmlFor={`b-${k}`}>
      <input id={`b-${k}`} value={b[k] || ''} onChange={set(k)} aria-invalid={!!errors[k]} {...props} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="admin-form" noValidate>
      <div className="row"><h1>{initial.id ? t('banners.edit') : t('banners.new')}</h1><button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button></div>

      <fieldset><legend>{t('banners.content')}</legend>
        <div className="two">
          {txt('title_ar', `${t('banners.bannerTitle')} (AR)`, { maxLength: 120, dir: 'rtl', required: true })}
          {txt('title_fr', `${t('banners.bannerTitle')} (FR)`, { maxLength: 120, dir: 'ltr', required: true })}
          {txt('subtitle_ar', `${t('banners.subtitle')} (AR)`, { maxLength: 240, dir: 'rtl' })}
          {txt('subtitle_fr', `${t('banners.subtitle')} (FR)`, { maxLength: 240, dir: 'ltr' })}
          {txt('button_ar', `${t('banners.button')} (AR)`, { maxLength: 40, dir: 'rtl' })}
          {txt('button_fr', `${t('banners.button')} (FR)`, { maxLength: 40, dir: 'ltr' })}
        </div>
      </fieldset>

      <fieldset><legend>{t('banners.destination')}</legend>
        <Field label={t('banners.linkType')} htmlFor="b-link_type">
          <select id="b-link_type" value={b.link_type} onChange={set('link_type')}>
            {['none', 'product', 'category', 'page', 'url'].map((k) => <option key={k} value={k}>{t(`banners.link.${k}`)}</option>)}
          </select>
        </Field>
        {b.link_type === 'product' && <Field label={t('banners.link.product')} error={errors.product_id && t(errors.product_id)} htmlFor="b-product_id">
          <select id="b-product_id" value={b.product_id || ''} onChange={set('product_id')}><option value="">—</option>{(prods.data || []).map((p) => <option key={p.id} value={p.id}>{p.name_fr || p.name_ar}</option>)}</select></Field>}
        {b.link_type === 'category' && <Field label={t('banners.link.category')} error={errors.category_id && t(errors.category_id)} htmlFor="b-category_id">
          <select id="b-category_id" value={b.category_id || ''} onChange={set('category_id')}><option value="">—</option>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name_fr || c.name_ar}</option>)}</select></Field>}
        {b.link_type === 'page' && <Field label={t('banners.link.page')} error={errors.page_path && t(errors.page_path)} htmlFor="b-page_path">
          <select id="b-page_path" value={b.page_path || ''} onChange={set('page_path')}>{PAGES.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>}
        {b.link_type === 'url' && txt('link_url', t('banners.link.url'), { dir: 'ltr', placeholder: '/products?category=…  |  https://…', inputMode: 'url' })}
        {b.link_type !== 'none' && <p className="hint">{t('banners.ctaHint')}</p>}
      </fieldset>

      <fieldset><legend>{t('banners.images')}</legend>
        <Field label={<>{t('banners.imageDesktop')} — <bdi dir="ltr">{BANNER_SIZES.desktop}</bdi></>} error={errors.image && t(errors.image)} htmlFor="b-img">
          <input id="b-img" type="file" accept="image/jpeg,image/png,image/webp" onChange={pick('desktop')} />
        </Field>
        {(dUrl || b.image_path) && <img className="admin-banner-thumb" src={dUrl || bannerImageUrl(b.image_path)} alt="" width="320" height="120" />}
        {progress.desktop != null && busy && <progress max="100" value={progress.desktop} aria-label={t('banners.uploading')}>{progress.desktop}%</progress>}
        <Field label={<>{t('banners.imageMobile')} — <bdi dir="ltr">{BANNER_SIZES.mobile}</bdi></>} error={errors.mobile && t(errors.mobile)} hint={t('banners.mobileHint')} htmlFor="b-mimg">
          <input id="b-mimg" type="file" accept="image/jpeg,image/png,image/webp" onChange={pick('mobile')} />
        </Field>
        {(mUrl || (b.mobile_image_path && !removeMobile)) && (
          <div className="row"><img className="admin-banner-thumb" src={mUrl || bannerImageUrl(b.mobile_image_path)} alt="" width="160" height="120" />
            <button type="button" className="btn btn-ghost" onClick={() => { setRemoveMobile(true); setFiles((x) => ({ ...x, mobile: null })); }}>{t('banners.removeMobile')}</button></div>
        )}
        {progress.mobile != null && busy && <progress max="100" value={progress.mobile} aria-label={t('banners.uploading')}>{progress.mobile}%</progress>}
        <div className="two">
          {txt('image_alt_ar', `${t('banners.alt')} (AR)`, { maxLength: 200, dir: 'rtl' })}
          {txt('image_alt_fr', `${t('banners.alt')} (FR)`, { maxLength: 200, dir: 'ltr' })}
        </div>
        <p className="hint">{t('banners.imgHint')}</p>
      </fieldset>

      <fieldset><legend>{t('banners.publishing')}</legend>
        <div className="two">
          <Field label={t('banners.starts')} htmlFor="b-starts"><input id="b-starts" type="datetime-local" value={toLocalInput(b.starts_at)} onChange={(e) => setB({ ...b, starts_at: fromLocalInput(e.target.value) })} /></Field>
          <Field label={t('banners.ends')} error={errors.ends_at && t(errors.ends_at)} htmlFor="b-ends"><input id="b-ends" type="datetime-local" value={toLocalInput(b.ends_at)} onChange={(e) => setB({ ...b, ends_at: fromLocalInput(e.target.value) })} aria-invalid={!!errors.ends_at} /></Field>
          <Field label={t('banners.order')} htmlFor="b-sort"><input id="b-sort" type="number" step="1" value={b.sort_order} onChange={set('sort_order')} /></Field>
        </div>
        <label className="inline"><input type="checkbox" checked={!!b.is_active} onChange={set('is_active')} /> {t('banners.enabled')}</label>
        <p className="hint">{t('banners.timeNote')}</p>
      </fieldset>

      <section aria-labelledby="b-prev">
        <div className="row"><h2 id="b-prev">{t('banners.preview')}</h2>
          <div role="group" aria-label={t('banners.preview')}>
            {['desktop', 'mobile'].map((v) => <button key={v} type="button" className={`btn${view === v ? ' btn-primary' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{t(`banners.view.${v}`)}</button>)}
          </div></div>
        <div className={`preview-frame pf-${view}`}><HeroCarousel banners={[previewBanner]} settings={{ autoplay: false, interval_seconds: 5, transition: 'slide' }} view={view} /></div>
      </section>

      {submitErr && <p className="bad" role="alert">{submitErr}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? t('banners.uploading') : t('common.save')}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
