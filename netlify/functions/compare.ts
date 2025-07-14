// compare.ts (snippet)

import { createClient } from '@supabase/supabase-js';
// ... altri import

export const handler = async (event) => {
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { import_id } = JSON.parse(event.body);

  // 1. Recupera tutti i products con vat_rate null
  const { data: badProducts, error: fetchError } = await supa
    .from('products')
    .select('minsan, shopify_sku')
    .is('vat_rate', null);

  if (fetchError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Errore fetch vat_rate: ' + fetchError.message })
    };
  }

  if (badProducts.length > 0) {
    // Lista i MINSAN mancanti e blocca la procedura
    const missing = badProducts.map(p => p.minsan).join(', ');
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `I seguenti prodotti non hanno VAT configurato: ${missing}`
      })
    };
  }

  // 2. Prosegui col flusso di compare solo se tutti i vat_rate sono presenti
  //    -> recupera i dati normalizzati, calcola differenze, popola pending_updates
  // ...
};


import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_NAME!;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN!;
const VAT_RATE = parseFloat(process.env.VAT_RATE || '0');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { import_id } = JSON.parse(event.body || '{}');
  if (!import_id) {
    return { statusCode: 400, body: 'import_id mancante' };
  }

  // 1. Carica dati normalizzati
  const { data: normalized, error: normErr } = await supabase
    .from('normalized_inventory')
    .select('*')
    .eq('import_id', import_id);
  if (normErr) return { statusCode: 500, body: `Error: ${normErr.message}` };

  // 2. Carica configurazione delle ditte
  const { data: companies } = await supabase.from('companies').select('name, markup_pct');
  const companyMap = new Map(companies!.map(c => [c.name, c.markup_pct]));

  // 3. Per ogni record, recupera prodotto Shopify e calcola differenze
  const updates: any[] = [];
  for (const rec of normalized!) {
    // Recupera dal DB prodotto con lo stesso minsan
    const { data: prod } = await supabase
      .from('products')
      .select('*')
      .eq('minsan', rec.minsan)
      .single();
    if (!prod) continue;

    // Calcola nuovo prezzo
    const markup = companyMap.get(prod.shopify_sku.split('-')[0]) || 0;
    const newPrice = parseFloat((prod.current_price * (1 + markup/100) * (1 + VAT_RATE)).toFixed(2));

    // Differenze
    const diffQty = rec.total_qty - prod.current_qty;
    const diffPrice = newPrice - prod.current_price;
    const significant = (Math.abs(diffQty) > 0) || (Math.abs(diffPrice) >= 0.01);

    if (significant) {
      updates.push({
        import_id,
        staging_id: null,
        product_id: prod.id,
        old_qty: prod.current_qty,
        new_qty: rec.total_qty,
        old_price: prod.current_price,
        new_price: newPrice,
        significant
      });
    }
  }

  // 4. Inserisci in pending_updates
  const { error: insertErr } = await supabase.from('pending_updates').insert(updates);
  if (insertErr) return { statusCode: 500, body: `Insert Error: ${insertErr.message}` };

  return {
    statusCode: 200,
    body: JSON.stringify({ import_id, updates_count: updates.length })
  };
};
