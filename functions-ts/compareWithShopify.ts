import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

/* ---------- Supabase ---------- */
const SUPABASE_URL         = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

/* ---------- Shopify ---------- */
const SHOPIFY_TOKEN       = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const SHOPIFY_STORE       = process.env.SHOPIFY_STORE_NAME!;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-07'; // <— DEFAULT “latest”

interface NormalizedRow {
  minsan: string;
  giacenza: number;
  prezzo_calcolato?: number;
  costo_medio?: number;
}

async function fetchVariantBySKU(sku: string) {
  const url   = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const query = `
    query getVariantBySku($sku: String!) {
      productVariants(first: 1, query: $sku) {
        edges {
          node {
            id
            sku
            price
            compareAtPrice
            inventoryQuantity
            inventoryItem { cost }
          }
        }
      }
    }`;

  const res = await fetch(url, {
    method : 'POST',
    headers: {
      'Content-Type'           : 'application/json',
      'X-Shopify-Access-Token' : SHOPIFY_TOKEN
    },
    body: JSON.stringify({ query, variables: { sku } })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Shopify response', res.status, text);
    throw new Error(`Shopify API error ${res.status}`);
  }
  return res.json().then((j) => j.data?.productVariants?.edges?.[0]?.node ?? null);
}

/* ---------- Netlify handler ---------- */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Only POST allowed' };
  }

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) {
      return { statusCode: 400, body: 'import_id mancante' };
    }

    /* 1️⃣ Righe normalizzate */
    const { data: rows, error } = await supabase
      .from('imports_normalized')
      .select('minsan, giacenza, prezzo_calcolato, costo_medio')
      .eq('import_id', import_id);

    if (error) {
      console.error(error);
      return { statusCode: 500, body: 'Errore lettura imports_normalized' };
    }

    /* 2️⃣ Diff per SKU */
    const comparison = [];
    for (const row of rows as NormalizedRow[]) {
      try {
        const variant = await fetchVariantBySKU(row.minsan);

        if (!variant) {
          comparison.push({
            import_id,
            minsan: row.minsan,
            inventory_diff       : null,
            price_diff           : null,
            compare_at_price_diff: null,
            cost_diff            : null,
            requires_update      : true
          });
          continue;
        }

        const inventoryDiff = row.giacenza - variant.inventoryQuantity;
        const priceDiff     = row.prezzo_calcolato
          ? Number(row.prezzo_calcolato) - Number(variant.price)
          : null;
        const costDiff      = row.costo_medio
          ? Number(row.costo_medio) - Number(variant.inventoryItem?.cost ?? 0)
          : null;

        comparison.push({
          import_id,
          minsan: row.minsan,
          inventory_diff       : inventoryDiff,
          price_diff           : priceDiff,
          compare_at_price_diff: null,
          cost_diff            : costDiff,
          requires_update      : !!(inventoryDiff || priceDiff || costDiff)
        });
      } catch (e) {
        console.error(`SKU ${row.minsan} – errore fetch variant`, e);
      }
    }

    /* 3️⃣ Scrive la tabella products_comparison */
    await supabase.from('products_comparison').delete().eq('import_id', import_id);
    const { error: insErr } = await supabase.from('products_comparison').insert(comparison);
    if (insErr) {
      console.error(insErr);
      return { statusCode: 500, body: 'Errore inserimento products_comparison' };
    }

    await supabase.from('imports').update({ status: 'compared' }).eq('id', import_id);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('Compare error', e);
    return { statusCode: 500, body: 'Errore interno confronto' };
  }
};
