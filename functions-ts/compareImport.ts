import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const SHOPIFY_STORE_NAME = process.env.SHOPIFY_STORE_NAME!;

// Supabase client with service role
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

interface ProductRecord {
  id: number;
  Ditta: string;
  Minsan: string;
  giacenza_norm: number;
  prezzo_vendita: number;
  prezzo_barrato: number;
  costo_medio_norm: number;
}

interface PendingUpdate {
  import_id: number;
  product_id: number;
  field: string;
  old_value: any;
  new_value: any;
}

// Helper to call Shopify Admin API
async function shopifyGraphQL(query: string, variables = {}) {
  const url = `https://${SHOPIFY_STORE_NAME}.myshopify.com/admin/api/2024-07/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

export const handler: Handler = async (event) => {
  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) {
      return { statusCode: 400, body: 'import_id is required' };
    }

    // 1. Fetch normalized products for this import
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id,Ditta,Minsan,giacenza_norm,prezzo_vendita,prezzo_barrato,costo_medio_norm')
      .eq('import_id', import_id);
    if (prodErr) throw prodErr;

    let changesCount = 0;
    const pending: PendingUpdate[] = [];

    for (const p of products as ProductRecord[]) {
      // 2. Query Shopify for the product by SKU (Minsan)
      const q = `query getProductBySKU($sku: String!) { products(first:1, query: $sku) { edges { node { id title variants(first:1, query: $sku) { edges { node { id inventoryQuantity price compareAtPrice metafields(first:1, namespace: \"custom\", keys: [\"costo_medio\"]) { edges { node { value } } } } } } } } } }`;
      const resp = await shopifyGraphQL(q, { sku: p.Minsan });
      const node = resp.data.products.edges[0]?.node;
      if (!node) continue;
      const variant = node.variants.edges[0]?.node;
      if (!variant) continue;

      // 3. Compare fields
      const shopQty = variant.inventoryQuantity;
      const shopPrice = parseFloat(variant.price);
      const shopCompare = variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null;
      const shopCostoField = variant.metafields.edges[0]?.node.value;
      const shopCosto = shopCostoField ? parseFloat(shopCostoField) : null;

      const checks: Array<{ field: string; old: any; new: any }> = [
        { field: 'giacenza', old: shopQty, new: p.giacenza_norm },
        { field: 'prezzo', old: shopPrice, new: p.prezzo_vendita },
        { field: 'prezzo_barrato', old: shopCompare, new: p.prezzo_barrato },
        { field: 'costo', old: shopCosto, new: p.costo_medio_norm }
      ];

      for (const chk of checks) {
        if (chk.old !== chk.new) {
          pending.push({ import_id, product_id: p.id, field: chk.field, old_value: chk.old, new_value: chk.new });
          changesCount++;
        }
      }
    }

    // 4. Insert pending updates
    if (pending.length) {
      const { error: pendErr } = await supabase
        .from('pending_updates')
        .insert(pending);
      if (pendErr) throw pendErr;
    }

    // 5. Find new companies count
    const { data: rawCompanies } = await supabase
      .from('imports_raw')
      .select('row_data')
      .eq('import_id', import_id);
    const companies = new Set((rawCompanies as any[])
      .map(r => JSON.parse(r.row_data).Ditta));
    const { data: existing } = await supabase
      .from('company_markups')
      .select('Ditta');
    const existingSet = new Set(existing!.map(e => e.Ditta));
    const newCompaniesCount = [...companies].filter(c => !existingSet.has(c)).length;

    return {
      statusCode: 200,
      body: JSON.stringify({ changes: changesCount, new_companies: newCompaniesCount })
    };
  } catch (err: any) {
    return { statusCode: 500, body: err.message };
  }
};
