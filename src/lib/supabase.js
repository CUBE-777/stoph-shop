import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY; // public anon key only — never a service_role key

export const isConfigured = Boolean(url && key);
export const supabase = isConfigured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;
export const BUCKET = 'product-images';

export function imageUrl(path) {
  if (!supabase || !path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export const BANNER_BUCKET = 'banner-images';
export function bannerImageUrl(path) {
  if (!supabase || !path) return null;
  return supabase.storage.from(BANNER_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Turns a Supabase/PostgREST error into a translation key (err.*).
export function errorKey(error) {
  if (!error) return 'err.generic';
  const msg = String(error.message || '');
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'err.network';
  if (/invalid.*(totp|code)|invalid_?code|verification/i.test(msg) && /mfa|totp|code/i.test(msg)) return 'err.mfa_bad_code';
  return /^[a-z_]+$/.test(msg) ? `err.${msg}` : 'err.generic';
}
