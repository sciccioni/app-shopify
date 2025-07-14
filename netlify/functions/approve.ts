import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL        = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY= process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE       = process.env.SHOPIFY_STORE_NAME!;
const SHOPIFY_TOKEN       = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const LOCATION_ID         = process.env.SHOPIFY_LOCATION_ID!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { update_ids } = JSON.parse(event.body || '{}');
  if (!Array.isArray(update_ids) || update_ids.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'update_ids mancanti' }) };
  }

  // Recupera tutte le pending_updates selezionate
  const { data: updates, error: fetchErr } = await supabase
    .from('pending_updates')
    .select(`
      id, staging_id, product_id,
      old_qty, new_qty, old_price, new_price
    `)
    .in('id', update_ids);

  if (fetchErr) {
    return { statusCode: 500, body: JSON.stringify({ error: fetchErr.message }) };
  }

  let applied = 0;

  for (const u of updates!) {
    // 1. Aggiorna inventory su Shopify
    const invBody = {
      location_id: LOCATION_ID,
      inventory_item_id: u.product_id, // se usi inventory_item_id
      available: u.new_qty
    };
    await fetch(`https://${SHOPIFY_STORE}.myshopify.com/admin/api/2025-01/inventory_levels/set.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ location_id: LOCATION_ID, inventory_item_id: u.product_id, available: u.new_qty })
    });
    // 2. Aggiorna prezzo su Shopify
    await fetch(`https://${SHOPIFY_STORE}.myshopify.com/admin/api/2025-01/variants/${u.product_id}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ variant: { id: u.product_id, price: u.new_price } })
    });

    // 3. Logga in operations_log
    await supabase.from('operations_log').insert({
      update_id: u.id,
      minsan: u.staging_id,  // o estrai minsan da normalized_inventory se preferisci
      action: 'approve_update',
      status: 'success',
      details: {
        qty: { from: u.old_qty, to: u.new_qty },
        price: { from: u.old_price, to: u.new_price }
      }
    });

    applied++;
  }

  // 4. Rimuovi o marca come processed le pending_updates (opzionale)
  await supabase
    .from('pending_updates')
    .update({ significant: false })
    .in('id', update_ids);

  return {
    statusCode: 200,
    body: JSON.stringify({ applied })
  };
};
