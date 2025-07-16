import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,          // service-role
  { auth: { persistSession: false } }
);

export const handler: Handler = async (event) => {

  /* ---------- GET → restituisce la lista completa ---------- */
  if (event.httpMethod === 'GET') {
    const { data, error } = await sb
      .from('company_markups')
      .select('ditta, markup_percentage')
      .order('ditta');
    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: JSON.stringify(data) };
  }

  /* ---------- POST → inserisce solo le nuove ditte (10 %) --- */
  if (event.httpMethod === 'POST') {
    const { data: rows, error } = await sb
      .from('products')
      .select('ditta')
      .not('ditta', 'is', null);
    if (error) return { statusCode: 500, body: error.message };

    const seen = new Set<string>();
    const insertRows = (rows || [])
      .map(r => (r.ditta ?? '').trim())
      .filter(n => n && !seen.has(n) && seen.add(n))
      .map(n => ({ ditta: n, markup_percentage: 10.0 }));

    if (!insertRows.length)
      return { statusCode: 200, body: JSON.stringify({ inserted: 0 }) };

    const { count, error: insErr } = await sb
      .from('company_markups')
      .insert(insertRows, { ignoreDuplicates: true, count: 'exact' });

    if (insErr) return { statusCode: 500, body: insErr.message };
    return { statusCode: 200, body: JSON.stringify({ inserted: count }) };
  }

  /* ---------- PUT → aggiorna (o crea) il markup di una ditta -- */
  if (event.httpMethod === 'PUT') {
    try {
      const { ditta, markup_percentage } = JSON.parse(event.body || '{}');
      if (!ditta || markup_percentage === undefined)
        return { statusCode: 400, body: 'ditta o markup_percentage mancante' };

      const { error } = await sb
        .from('company_markups')
        .upsert(
          { ditta: ditta.trim(), markup_percentage },
          { onConflict: 'ditta' }
        );

      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ updated: true }) };
    } catch (e: any) {
      console.error('PUT syncCompanyMarkups', e);
      return { statusCode: 500, body: e.message || 'Errore aggiornamento markup' };
    }
  }

  /* Altri metodi non permessi */
  return { statusCode: 405, body: 'Method not allowed' };
};
