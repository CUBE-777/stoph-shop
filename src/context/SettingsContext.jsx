import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dictionary } from '../i18n/dictionary.js';

const Ctx = createContext(null);
const read = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export function SettingsProvider({ children }) {
  const [lang, setLangState] = useState(() => (read('stoph.lang', 'ar') === 'fr' ? 'fr' : 'ar'));
  const [theme, setThemeState] = useState(() => (read('stoph.theme', 'dark') === 'light' ? 'light' : 'dark'));

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const setLang = useCallback((l) => { setLangState(l); write('stoph.lang', l); }, []);
  const setTheme = useCallback((t) => { setThemeState(t); write('stoph.theme', t); }, []);

  const value = useMemo(() => {
    const dict = dictionary[lang];
    const t = (key) => dict[key] ?? dictionary.ar[key] ?? key;
    // Picks name_ar / name_fr style fields with a fallback to the other language.
    const loc = (obj, field) => (obj ? obj[`${field}_${lang}`] || obj[`${field}_ar`] || obj[`${field}_fr`] || '' : '');
    const nf = new Intl.NumberFormat(lang === 'ar' ? 'ar-MA-u-nu-latn' : 'fr-MA', { maximumFractionDigits: 2 });
    const money = (n) => `${nf.format(Number(n) || 0)} ${t('common.currency')}`;
    return { lang, setLang, theme, setTheme, t, loc, money };
  }, [lang, theme, setLang, setTheme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useSettings = () => useContext(Ctx);
