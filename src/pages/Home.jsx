import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { listCategories, listProducts } from '../services/catalog.js';
import { Async, ProductCard } from '../components/ui.jsx';

export default function Home() {
  const { t, loc } = useSettings();
  const cats = useAsync(listCategories, []);
  const featured = useAsync(() => listProducts({ featured: true, limit: 8 }), []);
  return (
    <>
      <section className="hero">
        <h1 className="hero-mark">Stoph Shop</h1>
        <p className="hero-text">{t('home.tagline')}</p>
        <Link className="btn btn-primary" to="/products">{t('home.cta')}</Link>
      </section>

      {cats.data?.length > 0 && (
        <section aria-labelledby="h-cats">
          <h2 id="h-cats">{t('home.categories')}</h2>
          <ul className="chips">
            {cats.data.map((c) => <li key={c.id}><Link className="chip" to={`/products?category=${c.slug}`}>{loc(c, 'name')}</Link></li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="h-feat">
        <h2 id="h-feat">{t('home.featured')}</h2>
        <Async state={featured} empty={t('home.noFeatured')} isEmpty={(d) => d.length === 0}>
          {(d) => <div className="grid">{d.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
        </Async>
      </section>

      <section className="assurances" aria-label="Info">
        {[['cod', 'codText'], ['nation', 'nationText'], ['confirm', 'confirmText']].map(([h, p]) => (
          <div key={h}><h3>{t(`home.${h}`)}</h3><p>{t(`home.${p}`)}</p></div>
        ))}
      </section>
    </>
  );
}
