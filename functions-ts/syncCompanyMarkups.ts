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
      const allDitte = (data || [])
        .map(r => (r.ditta ?? '').trim())
        .filter(name => name.length)
        .filter(name => {
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        });

      if (!allDitte.length) {
        return { statusCode: 200, body: JSON.stringify({ inserted: 0 }) };
      }

      /* 3️⃣ verifica quali ditte non esistono già */
      const { data: existing, error: existingErr } = await sb
        .from('company_markups')
        .select('ditta')
        .in('ditta', allDitte);
      if (existingErr) throw existingErr;

      const existingDitte = new Set((existing || []).map(r => r.ditta));
      const newDitte = allDitte
        .filter(ditta => !existingDitte.has(ditta))
        .map(ditta => ({
          ditta,
          markup_percentage: 10.0
        }));

      if (!newDitte.length) {
        return { statusCode: 200, body: JSON.stringify({ inserted: 0 }) };
      }

      /* 4️⃣ inserisci solo le nuove ditte */
      const { count, error: insErr } = await sb
        .from('company_markups')
        .insert(newDitte, { count: 'exact' });
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

  /* ============   PUT → salva singolo markup   ============ */
  if (event.httpMethod === 'PUT') {
    try {
      const { ditta, markup_percentage } = JSON.parse(event.body || '{}');
      
      if (!ditta || markup_percentage === undefined) {
        return { statusCode: 400, body: 'Parametri mancanti' };
      }

      const { error } = await sb
        .from('company_markups')
        .upsert({ ditta, markup_percentage }, { onConflict: 'ditta' });
      
      if (error) throw error;

      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    } catch (e: any) {
      console.error('PUT company_markups', e);
      return { statusCode: 500, body: e.message || 'Errore salvataggio markup' };
    }
  }

  /* Altri metodi non ammessi */
  return { statusCode: 405, body: 'Method not allowed' };
};
