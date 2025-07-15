import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,   // service role → bypassa RLS
  { auth: { persistSession: false } }
);

export const handler: Handler = async (event) => {
  const { import_id } = event.queryStringParameters || {};
  if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

  try {
    /* 1️⃣  products → per contatori */
    const { count: unique } = await supabase
      .from('products')
      .select('minsan', { count: 'exact', head: true })
      .eq('import_id', import_id);

    /* 2️⃣  pending_updates → diff & SKU mancanti */
    const { data: rows, error } = await supabase
      .from('pending_updates')
      .select('minsan,ditta,product_title,changes')
      .eq('import_id', import_id);

    if (error) throw error;

    const changes = rows!.map((r) => {
      const c: any = {
        description : r.product_title ?? '',
        minsan      : r.minsan,
        ditta       : r.ditta ?? ''
      };

      if (r.changes?.missing) {
        c.note = 'Prodotto assente in Shopify';
      }
      if (r.changes?.inventory) {
        c.old_inventory = r.changes.inventory.old;
        c.new_inventory = r.changes.inventory.new;
      }
      if (r.changes?.price) {
        c.old_price = r.changes.price.old;
        c.new_price = r.changes.price.new;
      }
      if (r.changes?.cost) {
        c.old_cost = r.changes.cost.old;
        c.new_cost = r.changes.cost.new;
      }
      return c;
    });

    const newCompanies = new Set(
      rows!.filter(r => r.changes?.missing).map(r => r.ditta)
    ).size;

    return {
      statusCode: 200,
      body: JSON.stringify({
        stats: {
          total_rows     : rows!.length,
          unique_products: unique || 0,
          changes_found  : rows!.length,
          new_companies  : newCompanies
        },
        changes
      })
    };
  } catch (e: any) {
    console.error('getComparisonData error', e);
    return { statusCode: 500, body: e.message || 'Errore interno' };
  }
};
