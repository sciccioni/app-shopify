// src/services/DiffService.ts
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export class DiffService {
  static async run(importId: number) {
    const { data: prods } = await sb.from('products').select('*').eq('import_id', importId);
    const diffs = [];
    for (const p of prods!) {
      // GraphQL query Shopify
      const resp = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2025-01/graphql.json`, {
        method:'POST',
        headers:{
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD!,
          'Content-Type':'application/json'
        },
        body: JSON.stringify({ query: `
          {
            products(first:1, query:"variant_barcode:${p.ean}"){
              edges{node{ id title variants(first:1){edges{node{inventoryQuantity cost price}}}}}
            }
          }
        `})
      });
      const { data } = await resp.json();
      // estrai valori e compara, genera diff objects
      // ...
    }
    await sb.from('pending_updates').insert({ import_id: importId, updates: diffs });
    return diffs;
  }
}
