import { useEffect, useState } from 'react';
import { usePageMeta } from '../lib/meta.js';
import { useSearchParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { listCategories, listProducts, PAGE_SIZE } from '../services/catalog.js';
import { Async, ProductCard } from '../components/ui.jsx';
import { errorKey } from '../lib/supabase.js';

export default function Products() {
  const { t, loc } = useSettings();
  const [params, setParams] = useSearchParams();
  const get = (k, d = '') => params.get(k) ?? d;
  const [q, setQ] = useState(get('q'));
  const [extra, setExtra] = useState({ items: [], page: 0, done: false, busy: false, error: null });
  const cats = useAsync(listCategories, []);

  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);   // header search / links change ?q while this page stays mounted
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 800px)').matches);
  useEffect(() => { const m = window.matchMedia?.('(min-width: 800px)'); if (!m) return undefined; const on = () => setWide(m.matches); m.addEventListener?.('change', on); return () => m.removeEventListener?.('change', on); }, []);
  const slug = get('category');
  const categoryId = cats.data?.find((c) => c.slug === slug)?.id;
  const filters = { search: get('q'), sort: get('sort', 'new'), minPrice: get('min'), maxPrice: get('max') };
  const catPending = slug && !cats.data; // wait until the slug can be resolved

  usePageMeta({ title: t('products.title'), description: t('meta.products'), path: '/products' });
  useEffect(() => { setExtra({ items: [], page: 0, done: false, busy: false, error: null }); }, [slug, filters.search, filters.sort, filters.minPrice, filters.maxPrice]);
  const list = useAsync(
    () => (catPending ? Promise.resolve(null) : listProducts({ ...filters, categoryId: slug ? categoryId || '00000000-0000-0000-0000-000000000000' : undefined, limit: PAGE_SIZE })),
    [slug, categoryId, catPending, filters.search, filters.sort, filters.minPrice, filters.maxPrice],
  );

  const loadMore = (offset) => async () => {
    setExtra((x) => ({ ...x, busy: true, error: null }));
    try {
      const more = await listProducts({ ...filters, categoryId: slug ? categoryId || '00000000-0000-0000-0000-000000000000' : undefined, limit: PAGE_SIZE, offset });
      setExtra((x) => ({ ...x, items: [...x.items, ...more], busy: false, done: more.length < PAGE_SIZE }));
    } catch (e) { setExtra((x) => ({ ...x, busy: false, error: errorKey(e) })); }
  };
  const setParam = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  const submit = (e) => { e.preventDefault(); setParam('q', q.trim()); };
  const reset = () => { setQ(''); setParams({}, { replace: true }); };

  return (
    <>
      <h1>{t('products.title')}</h1>
      <form className="filters products-filters" onSubmit={submit} role="search">
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
        <details className="more-filters" open={wide || undefined} key={wide ? 'w' : 'n'}>
          <summary>{t('products.moreFilters')}{(get('q') || get('min') || get('max')) ? ' •' : ''}</summary>
          <div className="more-grid">
            <div className="field grow">
              <label htmlFor="q">{t('products.search')}</label>
              <input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} />
            </div>
            <div className="field narrow"><label htmlFor="min">{t('products.minPrice')}</label>
              <input id="min" type="number" min="0" inputMode="numeric" value={get('min')} onChange={(e) => setParam('min', e.target.value)} /></div>
            <div className="field narrow"><label htmlFor="max">{t('products.maxPrice')}</label>
              <input id="max" type="number" min="0" inputMode="numeric" value={get('max')} onChange={(e) => setParam('max', e.target.value)} /></div>
            <button className="btn btn-primary" type="submit">{t('common.search')}</button>
            <button className="btn btn-ghost" type="button" onClick={reset}>{t('products.reset')}</button>
          </div>
        </details>
      </form>

      <Async state={catPending ? { loading: true, error: null, data: null } : list} empty={<>{t('products.empty')}</>} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <>
            <p className="muted" aria-live="polite">{d.length + extra.items.length} {t('products.count')}</p>
            <div className="grid">{[...d, ...extra.items].map((p) => <ProductCard key={p.id} product={p} />)}</div>
            {extra.error && <p className="bad" role="alert">{t(extra.error)}</p>}
            {!extra.done && d.length >= PAGE_SIZE && (
              <p className="center"><button className="btn" disabled={extra.busy} onClick={loadMore(d.length + extra.items.length)}>{extra.busy ? t('common.loading') : t('common.more')}</button></p>
            )}
          </>
        )}
      </Async>
    </>
  );
}
