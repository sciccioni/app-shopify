import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

export const handler: Handler = async (event) => {
  const { import_id } = event.queryStringParameters || {};
  if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

  /* 1. stats di base */
  const { data: products } = await supabase
    .from('products')
    .select('minsan', { count: 'exact', head: true })
    .eq('import_id', import_id);

  /* 2. diff rilevate */
  const { data: changes } = await supabase
    .from('pending_updates')
    .select('*')
    .eq('import_id', import_id);

  const uniqueCompanies = new Set(changes?.map(c => c.ditta)).size;

  return {
    statusCode: 200,
    body: JSON.stringify({
      stats: {
        total_rows     : products?.count || 0,
        unique_products: products?.count || 0,
        changes_found  : changes?.length || 0,
        new_companies  : uniqueCompanies
      },
      changes
    })
  };
};
