// netlify/functions/get-staging.ts
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  const import_id = event.queryStringParameters?.import_id;
  if (!import_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'import_id mancante' }) };
  }

  const { data, error } = await supabase
    .from('staging_inventory')
    .select(`
      id,
      ditta,
      minsan,
      ean,
      descrizione,
      lotto,
      raw_quantity,
      costo_base,
      costomedio,
      ultimo_costo_ditta,
      data_ultimo_costo_ditta,
      prezzo_bd,
      iva,
      raw_expiry
    `)
    .eq('import_id', import_id)
    .order('id', { ascending: true });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
  return { statusCode: 200, body: JSON.stringify(data) };
};
