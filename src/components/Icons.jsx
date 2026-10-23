// Small inline SVG icon set (no icon library = no extra download). Decorative by default: pair with a text label or aria-label.
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' };
const I = (d) => function Icon({ filled, ...p }) { return <svg {...base} {...(filled ? { fill: 'currentColor' } : {})} {...p}>{d}</svg>; };
export const IconSearch = I(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconHeart = I(<path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 5 6.8 5c1.9 0 3.3 1 4.2 2.4h2C13.9 6 15.3 5 17.2 5c3.2 0 5.1 3 4 6.2-1.7 4.7-9.2 9.3-9.2 9.3Z" />);
export const IconCart = I(<><path d="M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h8.2a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></>);
export const IconHome = I(<><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /></>);
export const IconGrid = I(<><rect x="4" y="4" width="6.5" height="6.5" rx="1.2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" /></>);
export const IconBox = I(<><path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2L12 3Z" /><path d="m4 7.2 8 4.3 8-4.3M12 11.5V21" /></>);
export const IconMenu = I(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconClose = I(<path d="m6 6 12 12M18 6 6 18" />);
export const IconSun = I(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5" /></>);
export const IconMoon = I(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
export const IconGlobe = I(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.600 18.400 12 21c-2.6-2.6-3.8-5.6-3.8-9S9.400 5.600 12 3Z" /></>);
export const IconChevron = I(<path d="m9 6 6 6-6 6" />);      // points to the inline-end; flipped by CSS in RTL
export const IconPause = I(<path d="M8 5v14M16 5v14" />);
export const IconPlay = I(<path d="m8 5 11 7-11 7Z" />);
export const IconTruck = I(<><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7.500" cy="17.500" r="1.600" /><circle cx="17" cy="17.500" r="1.600" /></>);
export const IconShield = I(<path d="M12 3 4.500 6v5.500c0 4.500 3.200 8 7.500 9.500 4.300-1.500 7.500-5 7.500-9.500V6L12 3Z" />);
export const IconPhone = I(<path d="M6.500 3.500h3l1.500 4-2 1.500a11 11 0 0 0 6 6l1.500-2 4 1.500v3a2 2 0 0 1-2 2C10.800 19.500 4.500 13.200 4.500 5.500a2 2 0 0 1 2-2Z" />);
