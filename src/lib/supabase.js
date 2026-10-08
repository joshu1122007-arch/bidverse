import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
let validUrl = false;
try {
  validUrl = Boolean(url && new URL(url).protocol === 'https:' && !url.includes('YOUR_PROJECT'));
} catch { /* Missing or invalid configuration is handled by the UI. */ }

export const isConfigured = Boolean(validUrl && key && !key.includes('YOUR_'));
export const supabase = isConfigured ? createClient(url, key) : null;
