import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { chunk } from 'lodash';

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

/* --- helper batch -------------------------------------------------------- */
async function fetchVariantsBatch(skus: string[]) {
  const url = `https://${STORE}.myshopify.com/admin/api/${API_VER}/graphql.json`;

        const alias = skus.map((sku, i) => `
      v${i}: productVariants(first: 1, query: "sku:${sku}") {
        edges { node {
          id sku price inventoryQuantity compareAtPrice
          product { id title }
          inventoryItem { id unitCost { amount } }
        }}
      }
  `).join('\n');

  const res  = await fetch(url, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body   : JSON.stringify({ query: `query { ${alias} }` })
  });
  const json = await res.json();

  if (!res.ok || json.errors) {
    console.error('Shopify batch error', res.status, JSON.stringify(json.errors || json));
    throw new Error(`Shopify API error ${res.status}`);
  }

  const out: Record<string, any | null> = {};
  skus.forEach((sku, i) => {
    const edge = json.data[`v${i}`]?.edges?.[0];
    out[sku] = edge ? edge.node : null;
  });
  return out;
}

/* ---------- handler ------------------------------------------------------ */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const start = Date.now();

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

    const { data: rows, error } = await supabase
      .from('products')
      .select('minsan,ditta,giacenza,prezzo_calcolato,costo_medio,descrizione,prezzo_bd')
      .eq('import_id', import_id);
    if (error) throw error;

    if (!rows || !rows.length) {
      console.warn(`compareWithShopify → products vuota per import_id ${import_id}`);
      return { statusCode: 200, body: JSON.stringify({ success: true, rows: 0 }) };
    }

    const pending = [];
    let found = 0, missing = 0;
    for (const group of chunk(rows, 40)) {
      const batch = await fetchVariantsBatch(group.map(r => r.minsan));

      for (const r of group) {
        const v = batch[r.minsan];
        if (!v) {                                 // SKU assente → log & insert
          missing++;
          pending.push({
            import_id,
            minsan : r.minsan,
            ditta  : r.ditta,
            product_title: r.descrizione || null,
            changes: { missing: true }
          });
          continue;
        }
        found++;

        /* …dopo aver ottenuto v (Shopify) e r (Excel)… */
        const oldInv   = v.inventoryQuantity;
        const newInv   = r.giacenza;
        const oldPrice = Number(v.price);
        const newPrice = Number(r.prezzo_calcolato ?? oldPrice);
        const oldComp  = Number(v.compareAtPrice ?? 0);
        const newComp  = Number(r.prezzo_bd ?? oldComp);
        const oldCost  = Number(v.inventoryItem.unitCost?.amount ?? 0);
        const newCost  = Number(r.costo_medio ?? oldCost);

        /* Se tutti e quattro i pair sono identici, saltiamo la riga */
        if (
          oldInv === newInv &&
          oldPrice === newPrice &&
          oldComp === newComp &&
          oldCost === newCost
        ) continue;

        const changes: Record<string, any> = {};
        changes.inventory     = { old: oldInv, new: newInv };
        changes.price         = { old: oldPrice, new: newPrice };
        changes.compare_price = { old: oldComp, new: newComp };
        changes.cost          = { old: oldCost, new: newCost };

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
      }
    }

    // Pulisci i dati precedenti
    await supabase.from('pending_updates').delete().eq('import_id', import_id);
    
    // Inserisci i nuovi dati con gestione errori migliorata
    if (pending.length) {
      const { data: insData, error: insErr } =
        await supabase.from('pending_updates').insert(pending).select('id');
      if (insErr) {
        console.error('INSERT pending_updates', insErr);
        throw insErr;                  // fa tornare 500 se qualcosa va storto
      }
      console.log(`compareWithShopify → inserted ${insData?.length || 0} rows`);
    }

    await supabase.from('imports').update({ status: 'compared' }).eq('id', import_id);

    console.log(`compareWithShopify → found ${found}, missing ${missing}, diff ${pending.length}, tempo ${Date.now() - start} ms`);

    return { statusCode: 200, body: JSON.stringify({ success: true, rows: pending.length, found, missing }) };
  } catch (e: any) {
    console.error('Compare error', e);
    return { statusCode: 500, body: e.message || 'Errore confronto' };
  }
};
