// netlify/functions/get-normalized.ts
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

  // Seleziono * per vedere tutti i campi così come li hai nel DB
  const { data, error } = await supabase
    .from('normalized_inventory')
    .select('*')
    .eq('import_id', import_id)
    .order('id', { ascending: true });

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
