import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  const import_id = event.queryStringParameters?.import_id;
  if (!import_id) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'import_id mancante' })
    };
  }

  const { data, error } = await supabase
    .from('staging_inventory')
    .select(`
      id,
      minsan,
      lotto AS batch,
      giacenza AS raw_quantity,
      scadenza AS raw_expiry
    `)
    .eq('import_id', import_id)
    .order('minsan', { ascending: true });

  if (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
};
