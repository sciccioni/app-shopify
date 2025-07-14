import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL        = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY= process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const import_id = event.queryStringParameters?.import_id;
  if (!import_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'import_id mancante' }) };
  }

  // Recupera le proposte e il MINSAN dal record di staging
  const { data, error } = await supabase
    .from('pending_updates')
    .select(`
      id,
      old_qty,
      new_qty,
      old_price,
      new_price,
      staging_inventory ( minsan )
    `)
    .eq('import_id', import_id)
    .order('minsan', { foreignTable: 'staging_inventory' });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  // Rimappa i dati per semplificare il JSON
  const items = (data || []).map(u => ({
    id:        u.id,
    minsan:    u.staging_inventory.minsan,
    old_qty:   u.old_qty,
    new_qty:   u.new_qty,
    old_price: parseFloat(u.old_price.toString()),
    new_price: parseFloat(u.new_price.toString()),
  }));

  return {
    statusCode: 200,
    body: JSON.stringify(items)
  };
};
