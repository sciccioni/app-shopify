import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { import_id } = JSON.parse(event.body || '{}');
  if (!import_id) {
    return { statusCode: 400, body: 'import_id mancante' };
  }

  // 1) Chiama la RPC per ottenere i dati normalizzati
  const { data: normalized, error: rpcErr } = await supabase
    .rpc('normalize_inventory', { _import_id: import_id });

  if (rpcErr) {
    return { statusCode: 500, body: `RPC Error: ${rpcErr.message}` };
  }

  if (!normalized || normalized.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ normalized: 0 }) };
  }

  // 2) Svuota eventuali record precedenti per questo import_id
  await supabase
    .from('normalized_inventory')
    .delete()
    .eq('import_id', import_id);

  // 3) Inserisci i nuovi dati in bulk
  const toInsert = normalized.map(r => ({
    import_id: import_id,
    minsan:    r.minsan,
    total_qty: r.total_qty,
    expiry:    r.expiry
  }));

  const { error: insertErr } = await supabase
    .from('normalized_inventory')
    .insert(toInsert);

  if (insertErr) {
    return { statusCode: 500, body: `Insert Error: ${insertErr.message}` };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ normalized: toInsert.length })
  };
};
