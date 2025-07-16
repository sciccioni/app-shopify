import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

export const handler: Handler = async (event) => {
  /* ============   GET → restituisce la lista   ============ */
  if (event.httpMethod === 'GET') {
    try {
      const { data, error } = await sb
        .from('company_markups')
        .select('ditta, markup_percentage')
        .order('ditta');
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify(data) };
    } catch (e: any) {
      console.error('GET company_markups', e);
      return { statusCode: 500, body: e.message || 'Errore GET markups' };
    }
  }

  /* ============   POST → sincronizza ditte   ============ */
  if (event.httpMethod === 'POST') {
    try {
      /* 1️⃣ prendo tutte le ditte (possono arrivare duplicati) */
      const { data, error } = await sb
        .from('products')
        .select('ditta')
        .not('ditta', 'is', null);
      if (error) throw error;

      /* 2️⃣ deduplica in memoria */
      const seen = new Set<string>();
      const values = (data || [])
        .map(r => (r.ditta ?? '').trim())
        .filter(name => name.length)
        .filter(name => {
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        })
        .map(name => ({
          ditta: name,
          markup_percentage: 10.0
        }));

      if (!values.length) {
        return { statusCode: 200, body: JSON.stringify({ inserted: 0 }) };
      }

      /* 3️⃣ INSERT ... ON CONFLICT DO NOTHING (ignora i già esistenti) */
      const { count, error: insErr } = await sb
        .from('company_markups')
        .insert(values, { count: 'exact', ignoreDuplicates: true });
      if (insErr) throw insErr;

      return {
        statusCode: 200,
        body: JSON.stringify({ inserted: count })
      };
    } catch (e: any) {
      console.error('POST syncCompanyMarkups', e);
      return { statusCode: 500, body: e.message || 'Errore sync markups' };
    }
  }

  /* Altri metodi non ammessi */
  return { statusCode: 405, body: 'Method not allowed' };
};
