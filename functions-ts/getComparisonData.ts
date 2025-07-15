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
  
  try {
    /* stats unique products */
    const { count: unique } = await supabase
      .from('products')
      .select('minsan', { count: 'exact', head: true })
      .eq('import_id', import_id);
    
    /* diff rows */
    const { data: rows } = await supabase
      .from('pending_updates')
      .select('minsan,ditta,product_title,changes')
      .eq('import_id', import_id);
    
    const changes = rows!.map((r) => {
      const c: any = {
        description       : r.product_title ?? '',
        minsan           : r.minsan,
        ditta            : r.ditta ?? '',
        old_inventory    : '—',
        new_inventory    : '—',
        old_price        : '—',
        new_price        : '—',
        old_compare_price: '—',
        new_compare_price: '—',
        old_cost         : '—',
        new_cost         : '—',
        note             : ''
      };
      
      if (r.changes?.missing) {
        c.note = 'Prodotto assente in Shopify';
        return c;
      }
      
      if (r.changes?.inventory) {
        c.old_inventory = r.changes.inventory.old;
        c.new_inventory = r.changes.inventory.new;
      }
      
      if (r.changes?.price) {
        c.old_price = r.changes.price.old;
        c.new_price = r.changes.price.new;
      }
      
      if (r.changes?.compare_price) {
        c.old_compare_price = r.changes.compare_price.old;
        c.new_compare_price = r.changes.compare_price.new;
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
