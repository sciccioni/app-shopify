import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/dist/esm/index.js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
