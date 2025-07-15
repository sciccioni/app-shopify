import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

const STORE   = process.env.SHOPIFY_STORE_NAME!;
const TOKEN   = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const API_VER = process.env.SHOPIFY_API_VERSION || '2025-07';

async function getVariant(sku: string) {
  const url = `https://${STORE}/admin/api/${API_VER}/graphql.json`;
  const query = `
    query ($sku:String!){
      productVariants(first: 1, query:$sku){
        edges{ node{
          id sku price compareAtPrice inventoryQuantity
          product{ id title }
          inventoryItem{ id cost }
        }}
      }
    }`;
  const res = await fetch(url, {
    method : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN
    },
    body: JSON.stringify({ query, variables: { sku } })
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  return res.json().then((j) => j.data.productVariants.edges[0]?.node ?? null);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

    /* 1. prodotti normalizzati */
    const { data: rows, error } = await supabase
      .from('products')
      .select('minsan, ditta, giacenza, prezzo_calcolato, costo_medio')
      .eq('import_id', import_id);
    if (error) throw error;

    /* 2. calcolo diff */
    const pending = [];
    for (const r of rows!) {
      try {
        const v = await getVariant(r.minsan);
        if (!v) continue; // prodotto nuovo: verrà gestito più avanti

        const changes: Record<string, any> = {};
        if (r.giacenza !== v.inventoryQuantity) {
          changes.inventory = { old: v.inventoryQuantity, new: r.giacenza };
        }
        if (r.prezzo_calcolato && Number(r.prezzo_calcolato) !== Number(v.price)) {
          changes.price = { old: v.price, new: r.prezzo_calcolato };
        }
        if (
          r.costo_medio &&
          Number(r.costo_medio) !== Number(v.inventoryItem?.cost ?? 0)
        ) {
          changes.cost = { old: v.inventoryItem?.cost ?? 0, new: r.costo_medio };
        }
        if (!Object.keys(changes).length) continue;

        pending.push({
          import_id,
          product_id        : v.product.id,
          product_variant_id: v.id,
          inventory_item_id : v.inventoryItem.id,
          product_title     : v.product.title,
          minsan            : r.minsan,
          ditta             : r.ditta,
          changes
        });
      } catch (e) {
        console.error('SKU', r.minsan, e);
      }
    }

    await supabase.from('pending_updates').delete().eq('import_id', import_id);
    if (pending.length)
      await supabase.from('pending_updates').insert(pending);

    await supabase.from('imports').update({ status: 'compared' }).eq('id', import_id);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e: any) {
    console.error('Compare error', e);
    return { statusCode: 500, body: e.message || 'Errore confronto' };
  }
};
