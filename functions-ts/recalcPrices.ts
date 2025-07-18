import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'POST only' };

  try {
    const { ditta, import_id } = JSON.parse(event.body || '{}');
    if (!ditta) return { statusCode: 400, body: 'ditta mancante' };

    /* Recupero il markup attuale della ditta */
    const { data: mk, error: mkErr } = await sb
      .from('company_markups')
      .select('markup_percentage')
      .eq('ditta', ditta)
      .single();
    if (mkErr) throw mkErr;

    /* Chiamata alla funzione SQL per ricalcolare il prezzo per tutti i prodotti della ditta */
    const { data: upd, error: updErr } = await sb
      .rpc('recalc_prezzo_calcolato', {
        p_import_id: import_id || null,  // Se import_id è null, aggiorna tutti i prodotti
        p_ditta: ditta,
        p_markup: mk.markup_percentage,
      });
    if (updErr) throw updErr;

    return { statusCode: 200, body: JSON.stringify({ rows_updated: upd }) };
  } catch (e: any) {
    console.error('Errore nel calcolo del prezzo', e);
    return { statusCode: 500, body: e.message || 'Errore nel calcolo dei prezzi' };
  }
};
