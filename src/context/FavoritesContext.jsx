// Favourites live in this browser only (localStorage). The store has no customer accounts, so nothing is sent
// to the server. Product ids that no longer exist simply stop showing up on the favourites page.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sanitizeFavorites, toggleFavorite } from '../lib/shop.js';

const Ctx = createContext(null);
const KEY = 'stoph.favorites.v1';
const load = () => { try { return sanitizeFavorites(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } };

export function FavoritesProvider({ children }) {
  const [ids, setIds] = useState(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* ignore */ } }, [ids]);
  useEffect(() => {
    const onStorage = (e) => { if (e.key === KEY) setIds(load()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const toggle = useCallback((id) => setIds((cur) => toggleFavorite(cur, id)), []);
  const value = useMemo(() => ({ ids, toggle, has: (id) => ids.includes(id), count: ids.length }), [ids, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useFavorites = () => useContext(Ctx);
