import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { listCategories, listProducts, PAGE_SIZE } from '../services/catalog.js';
import { Async, ProductCard } from '../components/ui.jsx';

export default function Products() {
  const { t, loc } = useSettings();
  const [params, setParams] = useSearchParams();
  const get = (k, d = '') => params.get(k) ?? d;
  const [q, setQ] = useState(get('q'));
  const [pages, setPages] = useState(1);
  const cats = useAsync(listCategories, []);

  const slug = get('category');
  const categoryId = cats.data?.find((c) => c.slug === slug)?.id;
  const filters = { search: get('q'), sort: get('sort', 'new'), minPrice: get('min'), maxPrice: get('max') };
  const catPending = slug && !cats.data; // wait until the slug can be resolved

  useEffect(() => { setPages(1); }, [slug, filters.search, filters.sort, filters.minPrice, filters.maxPrice]);
  const list = useAsync(
    () => (catPending ? Promise.resolve(null) : listProducts({ ...filters, categoryId: slug ? categoryId || '00000000-0000-0000-0000-000000000000' : undefined, limit: PAGE_SIZE * pages })),
    [slug, categoryId, catPending, filters.search, filters.sort, filters.minPrice, filters.maxPrice, pages],
  );

  const setParam = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const submit = (e) => { e.preventDefault(); setParam('q', q.trim()); };
  const reset = () => { setQ(''); setParams({}, { replace: true }); };

  return (
    <>
      <h1>{t('products.title')}</h1>
      <form className="filters" onSubmit={submit} role="search">
        <div className="field grow">
          <label htmlFor="q">{t('products.search')}</label>
          <input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="cat">{t('products.category')}</label>
          <select id="cat" value={slug} onChange={(e) => setParam('category', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {cats.data?.map((c) => <option key={c.id} value={c.slug}>{loc(c, 'name')}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sort">{t('products.sort')}</label>
          <select id="sort" value={filters.sort} onChange={(e) => setParam('sort', e.target.value === 'new' ? '' : e.target.value)}>
            <option value="new">{t('products.sort.new')}</option>
            <option value="priceAsc">{t('products.sort.priceAsc')}</option>
            <option value="priceDesc">{t('products.sort.priceDesc')}</option>
          </select>
        </div>
        <div className="field narrow"><label htmlFor="min">{t('products.minPrice')}</label>
          <input id="min" type="number" min="0" inputMode="numeric" value={get('min')} onChange={(e) => setParam('min', e.target.value)} /></div>
        <div className="field narrow"><label htmlFor="max">{t('products.maxPrice')}</label>
          <input id="max" type="number" min="0" inputMode="numeric" value={get('max')} onChange={(e) => setParam('max', e.target.value)} /></div>
        <button className="btn btn-primary" type="submit">{t('common.search')}</button>
        <button className="btn btn-ghost" type="button" onClick={reset}>{t('products.reset')}</button>
      </form>

      <Async state={catPending ? { loading: true, error: null, data: null } : list} empty={<>{t('products.empty')}</>} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <>
            <p className="muted" aria-live="polite">{d.length} {t('products.count')}</p>
            <div className="grid">{d.map((p) => <ProductCard key={p.id} product={p} />)}</div>
            {d.length >= PAGE_SIZE * pages && (
              <p className="center"><button className="btn" onClick={() => setPages(pages + 1)}>{t('common.more')}</button></p>
            )}
          </>
        )}
      </Async>
    </>
  );
}
