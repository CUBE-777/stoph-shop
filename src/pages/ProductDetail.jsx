import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useCart } from '../context/CartContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { getProductBySlug } from '../services/catalog.js';
import { Async, Price } from '../components/ui.jsx';
import { imageUrl } from '../lib/supabase.js';
import { MAX_QTY, productAvailability, unitPrice } from '../lib/shop.js';

export default function ProductDetail() {
  const { slug } = useParams();
  const { t, loc } = useSettings();
  const state = useAsync(() => getProductBySlug(slug), [slug]);
  return <Async state={state} empty={t('product.notFound')} isEmpty={(d) => !d}>{(p) => <Detail product={p} />}</Async>;
}

function Detail({ product: p }) {
  const { t, loc } = useSettings();
  const { add } = useCart();
  const { hasVariants, available } = productAvailability(p);
  const [variantId, setVariantId] = useState(null);
  const [qty, setQty] = useState(1);
  const [img, setImg] = useState(0);
  const [added, setAdded] = useState(false);
  useEffect(() => { setVariantId(null); setImg(0); setAdded(false); }, [p.id]);

  const variant = p.product_variants.find((v) => v.id === variantId);
  const canAdd = available && (!hasVariants || (variant && variant.is_available));
  const images = p.product_images;

  const onAdd = () => {
    if (!canAdd) return;
    add({
      productId: p.id, variantId: variant?.id || null, qty, price: unitPrice(p), slug: p.slug,
      name_ar: p.name_ar, name_fr: p.name_fr,
      variant_ar: variant?.label_ar || null, variant_fr: variant?.label_fr || null,
      image: images[0]?.path || null,
    });
    setAdded(true);
  };

  return (
    <article className="detail">
      <div className="gallery">
        {images.length > 0
          ? <img className="img-main" src={imageUrl(images[img]?.path)} alt={images[img]?.alt || loc(p, 'name')} />
          : <div className="img-ph img-main">{t('product.noImage')}</div>}
        {images.length > 1 && (
          <ul className="thumbs">
            {images.map((im, i) => (
              <li key={im.path}><button className={i === img ? 'active' : ''} onClick={() => setImg(i)} aria-label={`${i + 1}`}>
                <img src={imageUrl(im.path)} alt="" loading="lazy" /></button></li>
            ))}
          </ul>
        )}
      </div>
      <div className="info">
        <p className="muted"><Link to="/products">{t('nav.products')}</Link>{p.categories && <> / <Link to={`/products?category=${p.categories.slug}`}>{loc(p.categories, 'name')}</Link></>}</p>
        <h1>{loc(p, 'name')}</h1>
        <Price product={p} />
        <p className={available ? 'ok' : 'bad'} role="status">{available ? t('product.available') : t('product.allUnavailable')}</p>
        <p className="desc">{loc(p, 'description')}</p>

        {hasVariants && (
          <fieldset className="variants">
            <legend>{t('product.choose')}</legend>
            {p.product_variants.map((v) => (
              <button key={v.id} type="button" disabled={!v.is_available} aria-pressed={v.id === variantId}
                className={`variant${v.id === variantId ? ' active' : ''}${v.is_available ? '' : ' off'}`} onClick={() => setVariantId(v.id)}>
                {loc(v, 'label')}{!v.is_available && <small> — {t('product.unavailable')}</small>}
              </button>
            ))}
          </fieldset>
        )}

        <div className="buy">
          <div className="field narrow"><label htmlFor="qty">{t('product.qty')}</label>
            <input id="qty" type="number" min="1" max={MAX_QTY} value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(MAX_QTY, Math.floor(Number(e.target.value)) || 1)))} /></div>
          <button className="btn btn-primary" disabled={!canAdd} onClick={onAdd}>{t('product.add')}</button>
        </div>
        {available && hasVariants && !variant && <p className="hint">{t('product.pickVariant')}</p>}
        {added && <p className="ok" role="status">{t('product.added')} — <Link to="/cart">{t('product.viewCart')}</Link></p>}
      </div>
    </article>
  );
}
