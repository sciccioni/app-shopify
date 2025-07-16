import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession:false } }
);

/* Formula SQL:
   prezzo_calcolato = costo_medio * (1 + markup%/100) * (1 + iva%/100)
*/
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode:405, body:'POST only' };

  try {
    const { ditta, import_id } = JSON.parse(event.body||'{}');
    if (!ditta || !import_id)
      return { statusCode:400, body:'ditta o import_id mancante' };

    /* ① prendo il markup aggiornato */
    const { data: mk } = await sb
      .from('company_markups')
      .select('markup_percentage')
      .eq('ditta', ditta)
      .single();
    if (!mk) return { statusCode:404, body:'markup non trovato' };

    /* ② aggiorno tutti i prodotti di quell’import */
    const { error } = await sb.rpc('recalc_prezzo_calcolato', {
      p_import_id : import_id,
      p_ditta     : ditta,
      p_markup    : mk.markup_percentage
    });
    if (error) throw error;

    return { statusCode:200, body:JSON.stringify({ success:true }) };
  } catch(e:any){
    console.error('recalcPrices', e);
    return { statusCode:500, body:e.message || 'Errore recalcolo' };
  }
};

