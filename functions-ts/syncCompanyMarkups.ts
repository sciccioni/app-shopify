import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,    // service-role => bypass RLS
  { auth: { persistSession:false } }
);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode:405, body:'POST only' };

  try {
    /* 1️⃣  prendo tutte le ditte distinte da products */
    const { data: ditte } = await sb
      .from('products')
      .select('ditta', { head:false, distinct:'ditta' })
      .not('ditta', 'is', null);

    const values = (ditte || [])
      .filter(d => d.ditta?.trim().length)
      .map(d => ({
        ditta: d.ditta.trim(),
        markup_percentage: 10.0
      }));

    if (!values.length)
      return { statusCode:200, body:JSON.stringify({ inserted:0 }) };

    /* 2️⃣  upsert nella tabella markups */
    const { count, error } = await sb
      .from('company_markups')
      .upsert(values, { onConflict:'ditta', count:'exact' });

    if (error) throw error;

    return { statusCode:200, body:JSON.stringify({ inserted: count }) };
  } catch (e:any) {
    console.error('syncCompanyMarkups', e);
    return { statusCode:500, body:e.message || 'Errore sync markups' };
  }
};
