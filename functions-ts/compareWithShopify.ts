import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

/* ---------- Supabase ---------- */
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

/* ---------- Shopify ---------- */
const STORE   = process.env.SHOPIFY_STORE_NAME!;
const TOKEN   = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const API_VER = process.env.SHOPIFY_API_VERSION || '2025-07';

/* ----- helper: cerca la variante per SKU ----- */
async function fetchVariantBySKU(sku: string) {
  const url = `https://${STORE}/admin/api/${API_VER}/graphql.json`;

  const query = /* GraphQL */ `
    query getVariantBySku($search: String!) {
      productVariants(first: 1, query: $search) {
        edges {
          node {
            id
            sku
            price
            compareAtPrice
            quantityAvailable
            product { id title }
            inventoryItem { id cost }
          }
        }
      }
    }`;

  const res = await fetch(url, {
    method : 'POST',
    headers: {
      'Content-Type'           : 'application/json',
      'X-Shopify-Access-Token' : TOKEN
    },
    body: JSON.stringify({ query, variables: { search: `sku:${sku}` } })
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    console.error('Shopify error', res.status, JSON.stringify(json.errors || json));
    throw new Error(`Shopify API error ${res.status}`);
  }

  return json.data?.productVariants?.edges?.[0]?.node ?? null;
}

/* ---------- Netlify handler ---------- */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

    /* 1. prodotti normalizzati */
    const { data: rows, error } = await supabase
      .from('products')
      .select('minsan,ditta,giacenza,prezzo_calcolato,costo_medio')
      .eq('import_id', import_id);

    if (error) throw error;

    /* 2. calcola diff */
    const pending = [];
    for (const r of rows!) {
      if (!r.minsan) continue;                       // sicurezza extra
      try {
        const v = await fetchVariantBySKU(r.minsan);
        if (!v) continue;                           // prodotto ancora da creare

        const changes: Record<string, any> = {};

        // Quantità
        const oldQty = v.quantityAvailable ?? v.inventoryQuantity;
        if (r.giacenza !== oldQty) {
          changes.inventory = { old: oldQty, new: r.giacenza };
        }

        // Prezzo di vendita
        if (r.prezzo_calcolato &&
            Number(r.prezzo_calcolato) !== Number(v.price)) {
          changes.price = { old: v.price, new: r.prezzo_calcolato };
        }

        // Costo
        const oldCost = Number(v.inventoryItem?.cost ?? 0);
        if (r.costo_medio && Number(r.costo_medio) !== oldCost) {
          changes.cost = { old: oldCost, new: r.costo_medio };
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

    /* 3. scrive pending_updates */
    await supabase.from('pending_updates').delete().eq('import_id', import_id);
    if (pending.length) await supabase.from('pending_updates').insert(pending);

    await supabase.from('imports').update({ status: 'compared' }).eq('id', import_id);
    return { statusCode: 200, body: JSON.stringify({ success: true, rows: pending.length }) };
  } catch (e: any) {
    console.error('Compare error', e);
    return { statusCode: 500, body: e.message || 'Errore confronto' };
  }
};
