// Minimal react-router-dom stand-in for the verification harness ONLY (the real package is not installed offline).
import React, { createContext, useContext, useEffect, useState, Children } from 'react';
const R = createContext(null); const Chain = createContext({ rest: [], params: {}, base: '' });
export function BrowserRouter({ children }) {
  const read = () => ({ pathname: location.pathname, search: location.search, state: history.state });
  const [loc, setLoc] = useState(read);
  useEffect(() => { const f = () => setLoc(read()); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  const navigate = (to, o = {}) => { history[o.replace ? 'replaceState' : 'pushState'](o.state || null, '', to); setLoc(read()); window.scrollTo(0, 0); };
  return <R.Provider value={{ loc, navigate }}>{children}</R.Provider>;
}
export const useLocation = () => useContext(R).loc;
export const useNavigate = () => useContext(R).navigate;
export const useParams = () => useContext(Chain).params;
export function useSearchParams() { const { loc, navigate } = useContext(R); return [new URLSearchParams(loc.search), (n, o) => navigate(loc.pathname + '?' + new URLSearchParams(n).toString(), o)]; }
export function Route() { return null; }
const seg = (p) => p.split('/').filter(Boolean);
function match(routes, parts, params = {}) {
  for (const r of routes) {
    const { path, index, element, children } = r;
    if (index) { if (parts.length === 0) return { chain: [element], params, base: 0 }; continue; }
    if (path === undefined) { const m = match(children, parts, params); if (m) return { ...m, chain: [element, ...m.chain] }; continue; }
    const ps = seg(path); let i = 0; const np = { ...params }; let ok = true; let splat = false;
    for (const p of ps) { if (p === '*') { splat = true; break; } if (i >= parts.length) { ok = false; break; } if (p.startsWith(':')) np[p.slice(1)] = decodeURIComponent(parts[i]); else if (p !== parts[i]) { ok = false; break; } i++; }
    if (!ok) continue;
    if (children?.length) { const m = match(children, parts.slice(i), np); if (m) return { ...m, chain: [element, ...m.chain], base: i + (m.base || 0) }; continue; }
    if (splat || i === parts.length) return { chain: [element], params: np, base: i };
  }
  return null;
}
const toRoutes = (children) => Children.toArray(children).filter(Boolean).map((c) => ({ ...c.props, children: c.props.children ? toRoutes(c.props.children) : undefined }));
export function Routes({ children }) {
  const { loc } = useContext(R); const outer = useContext(Chain);
  const parts = seg(loc.pathname).slice(outer.consumed || 0);
  const m = match(toRoutes(children), parts, outer.params);
  if (!m) return null;
  const render = (chain, k = 0) => chain.length === 0 ? null : <Chain.Provider value={{ rest: chain.slice(1), params: m.params, consumed: (outer.consumed || 0) + m.base, render }}>{chain[0]}</Chain.Provider>;
  return render(m.chain);
}
export function Outlet() { const c = useContext(Chain); return c.rest.length ? <Chain.Provider value={{ ...c, rest: c.rest.slice(1) }}>{c.rest[0]}</Chain.Provider> : null; }
export function Navigate({ to, replace }) { const { navigate } = useContext(R); useEffect(() => navigate(to, { replace }), []); return null; }
export function Link({ to, onClick, children, ...p }) { const { navigate } = useContext(R); return <a href={to} {...p} onClick={(e) => { onClick?.(e); if (e.defaultPrevented || e.metaKey || e.ctrlKey || p.target === '_blank') return; e.preventDefault(); navigate(to); }}>{children}</a>; }
export function NavLink({ to, end, className, children, ...p }) {
  const { loc } = useContext(R); const path = to.split('?')[0];
  const active = end ? loc.pathname === path : loc.pathname === path || loc.pathname.startsWith(path + '/');
  return <Link to={to} {...p} className={[typeof className === 'string' ? className : '', active ? 'active' : ''].join(' ').trim()} aria-current={active ? 'page' : undefined}>{children}</Link>;
}
