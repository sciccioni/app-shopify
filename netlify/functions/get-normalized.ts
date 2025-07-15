// netlify/functions/get-normalized.ts
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export const handler: Handler = async ({ queryStringParameters }) => {
  const import_id = queryStringParameters?.import_id;
  if (!import_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'import_id mancante' }) };
  }
  const { data, error } = await supabase
    .from('normalized_inventory')
    .select('minsan, total_qty, expiry, costomedio, prezzo_bd, iva, ditta')
    .eq('import_id', import_id)
    .order('minsan', { ascending: true });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
  return { statusCode: 200, body: JSON.stringify(data) };
};
