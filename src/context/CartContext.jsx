import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { addToCart, cartCount, cartSubtotal, removeLine, setQty } from '../lib/shop.js';
import { fetchProductsByIds } from '../services/catalog.js';

const Ctx = createContext(null);
const KEY = 'stoph.cart.v1';

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && x.productId && Number.isInteger(x.qty)) : [];
  } catch { return []; }
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(load);
  const [priceChanged, setPriceChanged] = useState(false);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ } }, [items]);

  const add = useCallback((item) => setItems((c) => addToCart(c, item)), []);
  const update = useCallback((key, qty) => setItems((c) => setQty(c, key, qty)), []);
  const remove = useCallback((key) => setItems((c) => removeLine(c, key)), []);
  const clear = useCallback(() => setItems([]), []);

  // Re-reads live prices/availability so the cart never shows stale data.
  // (The server still re-validates everything when the order is placed.)
  const refresh = useCallback(async () => {
    if (items.length === 0) return;
    const products = await fetchProductsByIds([...new Set(items.map((i) => i.productId))]);
    const byId = new Map(products.map((p) => [p.id, p]));
    let changed = false;
    setItems((cur) => cur.map((it) => {
      const p = byId.get(it.productId);
      if (!p) return { ...it, unavailable: true };
      const price = p.sale_price != null && Number(p.sale_price) < Number(p.price) ? Number(p.sale_price) : Number(p.price);
      const v = it.variantId ? (p.product_variants || []).find((x) => x.id === it.variantId) : null;
      const unavailable = it.variantId ? !v || !v.is_available : !p.is_available || (p.product_variants || []).length > 0;
      if (price !== Number(it.price)) changed = true;
      return { ...it, price, unavailable };
    }));
    setPriceChanged(changed);
  }, [items]);

  const value = useMemo(() => ({
    items, add, update, remove, clear, refresh, priceChanged,
    count: cartCount(items), subtotal: cartSubtotal(items),
    hasUnavailable: items.some((i) => i.unavailable),
  }), [items, add, update, remove, clear, refresh, priceChanged]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useCart = () => useContext(Ctx);
