// Applies saved language/theme before first paint. Kept as an external file so the CSP can forbid inline scripts.
try {
  var l = localStorage.getItem('stoph.lang') || 'ar';
  var t = localStorage.getItem('stoph.theme') || 'dark';
  document.documentElement.lang = l === 'fr' ? 'fr' : 'ar';
  document.documentElement.dir = l === 'fr' ? 'ltr' : 'rtl';
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
} catch (e) { /* storage unavailable: defaults from index.html */ }
