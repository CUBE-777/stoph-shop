import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { Async, Field } from '../components/ui.jsx';
import { errorKey, imageUrl } from '../lib/supabase.js';
import { productAvailability } from '../lib/shop.js';
import { useAdmin } from './context.js';
import { ALLOWED_IMAGES, MAX_IMAGE_BYTES, adminCategories, adminProduct, adminProducts, deleteProduct, saveProduct } from '../services/admin.js';

export function ProductList() {
  const { t, loc, money } = useSettings();
  const { can } = useAdmin();
  const state = useAsync(adminProducts, []);
  const remove = async (p) => {
    if (!window.confirm(t('common.confirmDelete'))) return;
    try { await deleteProduct(p.id); state.reload(); } catch (e) { window.alert(t(errorKey(e))); }
  };
  return (
    <>
      <div className="row"><h1>{t('admin.nav.products')}</h1>{can('products.create') && <Link className="btn btn-primary" to="/admin/products/new">{t('admin.products.new')}</Link>}</div>
      <Async state={state} empty={t('admin.products.empty')} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <div className="table-wrap"><table>
            <thead><tr><th></th><th>{t('admin.f.nameFr')}</th><th>{t('admin.f.price')}</th><th>{t('common.active')}</th><th>{t('product.available')}</th><th>{t('common.actions')}</th></tr></thead>
            <tbody>{d.map((p) => {
              const img = [...p.product_images].sort((a, b) => a.sort_order - b.sort_order)[0];
              const { available } = productAvailability(p);
              return (
                <tr key={p.id}>
                  <td>{img ? <img className="thumb" src={imageUrl(img.path)} alt="" /> : <span className="thumb img-ph" />}</td>
                  <td>{loc(p, 'name')}</td>
                  <td>{money(p.sale_price ?? p.price)}</td>
                  <td>{p.is_published ? t('common.yes') : t('common.no')}</td>
                  <td>{available ? t('common.yes') : t('common.no')}</td>
                  <td className="actions">{can('products.update') && <Link className="btn" to={`/admin/products/${p.id}`}>{t('common.edit')}</Link>}
                    {can('products.delete') && <button className="btn btn-ghost" onClick={() => remove(p)}>{t('common.delete')}</button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Async>
    </>
  );
}

const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};
const EMPTY = { sale_starts_at: '', sale_ends_at: '', name_ar: '', name_fr: '', description_ar: '', description_fr: '', price: '', sale_price: '', category_id: '', is_published: false, is_featured: false, is_available: true };
const EMPTY_VARIANT = { label_ar: '', label_fr: '', color: '', size: '', capacity: '', is_available: true };

export function ProductForm() {
  const { id } = useParams();
  const state = useAsync(() => (id ? adminProduct(id) : Promise.resolve(null)), [id]);
  if (id && state.loading) return <p className="state" role="status">…</p>;
  if (id && state.error) return <Async state={state}>{() => null}</Async>;
  return <FormBody initial={state.data} />;
}

function FormBody({ initial }) {
  const { t, loc } = useSettings();
  const navigate = useNavigate();
  const cats = useAsync(adminCategories, []);
  const [p, setP] = useState(initial ? { ...EMPTY, ...initial, sale_price: initial.sale_price ?? '', sale_starts_at: toLocal(initial.sale_starts_at), sale_ends_at: toLocal(initial.sale_ends_at) } : EMPTY);
  const [variants, setVariants] = useState(initial?.product_variants || []);
  const [removedVariantIds, setRemovedVariantIds] = useState([]);
  const [images, setImages] = useState(initial?.product_images || []);
  const [removedImages, setRemovedImages] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => images.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []); // eslint-disable-line

  const set = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setV = (i, k, v) => setVariants(variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const delV = (i) => { if (variants[i].id) setRemovedVariantIds([...removedVariantIds, variants[i].id]); setVariants(variants.filter((_, j) => j !== i)); };
  const move = (i, d) => { const n = [...images]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setImages(n); };
  const delImg = (i) => { const im = images[i]; if (im.id) setRemovedImages([...removedImages, im]); if (im.preview) URL.revokeObjectURL(im.preview); setImages(images.filter((_, j) => j !== i)); };

  const onFiles = (e) => {
    const next = [];
    let bad = false;
    for (const f of e.target.files) {
      if (!ALLOWED_IMAGES.includes(f.type) || f.size > MAX_IMAGE_BYTES) { bad = true; continue; }
      next.push({ file: f, preview: URL.createObjectURL(f) });
    }
    setMsg(bad ? { type: 'bad', text: t('admin.f.imgBad') } : null);
    setImages([...images, ...next]);
    e.target.value = '';
  };

  const valid = () => {
    const price = Number(p.price);
    const sale = p.sale_price === '' ? null : Number(p.sale_price);
    return p.name_ar.trim() && p.name_fr.trim() && p.price !== '' && price >= 0 && (sale == null || (sale >= 0 && sale < price))
      && !(p.sale_starts_at && p.sale_ends_at && new Date(p.sale_ends_at) <= new Date(p.sale_starts_at))
      && variants.every((v) => v.label_ar.trim() && v.label_fr.trim());
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!valid()) { setMsg({ type: 'bad', text: t('admin.f.invalid') }); return; }
    setBusy(true); setMsg(null);
    try {
      await saveProduct({ product: p, variants, removedVariantIds, images, removedImages });
      navigate('/admin/products');
    } catch (err) { setMsg({ type: 'bad', text: t(errorKey(err)) }); }
    finally { setBusy(false); }
  };

  return (
    <form className="admin-form" onSubmit={submit} noValidate>
      <h1>{initial ? t('common.edit') : t('admin.products.new')}</h1>
      <div className="two">
        <Field label={t('admin.f.nameAr')} htmlFor="n_ar"><input id="n_ar" dir="rtl" value={p.name_ar} onChange={set('name_ar')} maxLength={200} required /></Field>
        <Field label={t('admin.f.nameFr')} htmlFor="n_fr"><input id="n_fr" dir="ltr" value={p.name_fr} onChange={set('name_fr')} maxLength={200} required /></Field>
        <Field label={t('admin.f.descAr')} htmlFor="d_ar"><textarea id="d_ar" dir="rtl" rows="4" value={p.description_ar} onChange={set('description_ar')} /></Field>
        <Field label={t('admin.f.descFr')} htmlFor="d_fr"><textarea id="d_fr" dir="ltr" rows="4" value={p.description_fr} onChange={set('description_fr')} /></Field>
        <Field label={t('admin.f.price')} htmlFor="price"><input id="price" type="number" min="0" step="0.01" value={p.price} onChange={set('price')} required /></Field>
        <Field label={t('admin.f.sale')} htmlFor="sale"><input id="sale" type="number" min="0" step="0.01" value={p.sale_price} onChange={set('sale_price')} /></Field>
        <Field label={t('admin.f.saleStart')} htmlFor="ss"><input id="ss" type="datetime-local" value={p.sale_starts_at} onChange={set('sale_starts_at')} /></Field>
        <Field label={t('admin.f.saleEnd')} htmlFor="se"><input id="se" type="datetime-local" value={p.sale_ends_at} onChange={set('sale_ends_at')} /></Field>
        <Field label={t('admin.f.category')} htmlFor="cat">
          <select id="cat" value={p.category_id || ''} onChange={set('category_id')}>
            <option value="">{t('admin.f.none')}</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{loc(c, 'name')}</option>)}
          </select>
        </Field>
      </div>
      <div className="checks">
        <label><input type="checkbox" checked={p.is_published} onChange={set('is_published')} /> {t('admin.f.published')}</label>
        <label><input type="checkbox" checked={p.is_featured} onChange={set('is_featured')} /> {t('admin.f.featured')}</label>
        <label><input type="checkbox" checked={p.is_available} onChange={set('is_available')} /> {t('admin.f.available')}</label>
        <small className="hint">{t('admin.f.variantsNote')}</small>
      </div>

      <fieldset>
        <legend>{t('admin.variants')}</legend>
        {variants.map((v, i) => (
          <div className="variant-row" key={v.id || `n${i}`}>
            <input aria-label={t('admin.v.labelAr')} placeholder={t('admin.v.labelAr')} dir="rtl" value={v.label_ar} onChange={(e) => setV(i, 'label_ar', e.target.value)} />
            <input aria-label={t('admin.v.labelFr')} placeholder={t('admin.v.labelFr')} dir="ltr" value={v.label_fr} onChange={(e) => setV(i, 'label_fr', e.target.value)} />
            <input aria-label={t('admin.v.color')} placeholder={t('admin.v.color')} value={v.color || ''} onChange={(e) => setV(i, 'color', e.target.value)} />
            <input aria-label={t('admin.v.size')} placeholder={t('admin.v.size')} value={v.size || ''} onChange={(e) => setV(i, 'size', e.target.value)} />
            <input aria-label={t('admin.v.capacity')} placeholder={t('admin.v.capacity')} value={v.capacity || ''} onChange={(e) => setV(i, 'capacity', e.target.value)} />
            <label className="inline"><input type="checkbox" checked={v.is_available} onChange={(e) => setV(i, 'is_available', e.target.checked)} /> {t('admin.v.available')}</label>
            <button type="button" className="btn btn-ghost" onClick={() => delV(i)}>{t('common.delete')}</button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setVariants([...variants, { ...EMPTY_VARIANT }])}>{t('admin.variants.add')}</button>
      </fieldset>

      <fieldset>
        <legend>{t('admin.images')}</legend>
        <p className="hint">{t('admin.images.first')}</p>
        <ul className="img-list">
          {images.map((im, i) => (
            <li key={im.id || im.preview}>
              <img src={im.preview || imageUrl(im.path)} alt="" />
              <div>
                <button type="button" className="btn btn-ghost" onClick={() => move(i, -1)} disabled={i === 0}>{t('admin.images.up')}</button>
                <button type="button" className="btn btn-ghost" onClick={() => move(i, 1)} disabled={i === images.length - 1}>{t('admin.images.down')}</button>
                <button type="button" className="btn btn-ghost" onClick={() => delImg(i)}>{t('common.delete')}</button>
              </div>
            </li>
          ))}
        </ul>
        <Field label={t('admin.images.upload')} htmlFor="files"><input id="files" type="file" accept={ALLOWED_IMAGES.join(',')} multiple onChange={onFiles} /></Field>
      </fieldset>

      {msg && <p className={msg.type === 'bad' ? 'bad' : 'ok'} role="alert">{msg.text}</p>}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? t('common.loading') : t('common.save')}</button>
        <Link className="btn btn-ghost" to="/admin/products">{t('common.cancel')}</Link>
      </div>
    </form>
  );
}
