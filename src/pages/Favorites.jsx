import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useFavorites } from '../context/FavoritesContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { listProductsByIds } from '../services/catalog.js';
import { Async, ProductCard } from '../components/ui.jsx';
import { usePageMeta } from '../lib/meta.js';

export default function Favorites() {
  const { t } = useSettings();
  const fav = useFavorites();
  usePageMeta({ title: t('nav.favorites'), noindex: true });
  const key = fav.ids.join(',');
  const state = useAsync(() => listProductsByIds(fav.ids), [key]);
  return (
    <>
      <h1>{t('nav.favorites')}</h1>
      <p className="muted">{t('fav.note')}</p>
      {fav.ids.length === 0
        ? <section className="state"><p>{t('fav.empty')}</p><Link className="btn btn-primary" to="/products">{t('home.cta')}</Link></section>
        : <Async state={state} empty={t('fav.empty')} isEmpty={(d) => d.length === 0}>{(d) => <div className="grid">{d.map((p) => <ProductCard key={p.id} product={p} />)}</div>}</Async>}
    </>
  );
}
