import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { import_id } = JSON.parse(event.body || '{}');
  if (!import_id) {
    return { statusCode: 400, body: 'import_id mancante' };
  }

  // Query raw staging data
  const { data: rows, error: fetchError } = await supabase
    .from('staging_inventory')
    .select('minsan, raw_quantity, raw_expiry')
    .eq('import_id', import_id);
  if (fetchError) {
    return { statusCode: 500, body: `Fetch Error: ${fetchError.message}` };
  }

  // Raggruppa e calcola
  const map = new Map<string, { qty: number; expiry: Date | null }>();
  rows!.forEach(r => {
    const key = r.minsan;
    const prev = map.get(key) || { qty: 0, expiry: null };
    // Somma quantità
    let sumQty = prev.qty + r.raw_quantity;
    if (sumQty < 0) sumQty = 0;
    // Scadenza minima
    const exp = r.raw_expiry ? new Date(r.raw_expiry) : null;
    let earliest = prev.expiry;
    if (exp && (!earliest || exp < earliest)) earliest = exp;
    map.set(key, { qty: sumQty, expiry: earliest });
  });

  // Prepara insert batch
  const normalized = Array.from(map.entries()).map(([minsan, { qty, expiry }]) => ({
    import_id,
    minsan,
    total_qty: qty,
    earliest_expiry: expiry,
  }));

  // Svuota vecchi normalized per import_id e inserisci i nuovi
  const { error: delError } = await supabase
    .from('normalized_inventory')
    .delete()
    .eq('import_id', import_id);
  if (delError) {
    return { statusCode: 500, body: `Delete Error: ${delError.message}` };
  }

  const { error: insertError } = await supabase
    .from('normalized_inventory')
    .insert(normalized);
  if (insertError) {
    return { statusCode: 500, body: `Insert Error: ${insertError.message}` };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ import_id, normalized_count: normalized.length })
  };
};
