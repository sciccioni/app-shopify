// netlify/functions/compare.ts

import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  let import_id: string;
  try {
    const body = JSON.parse(event.body || '{}');
    import_id = body.import_id;
    if (!import_id) throw new Error('import_id mancante');
  } catch (err: any) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }

  // 1) Verifica VAT
  const { data: badProducts, error: fetchError } = await supabase
    .from('products')
    .select('minsan, shopify_sku')
    .is('vat_rate', null);

  if (fetchError) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: fetchError.message })
    };
  }

  if (badProducts && badProducts.length > 0) {
    const missing = badProducts.map(p => p.minsan).join(', ');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Prodotti senza VAT configurato: ${missing}` })
    };
  }

  // 2) Carica normalized_inventory
  const { data: normalized, error: normErr } = await supabase
    .from('normalized_inventory')
    .select('*')
    .eq('import_id', import_id);
  if (normErr) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: normErr.message })
    };
  }

  // 3) Carica companies per markup
  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('name, markup_pct');
  if (compErr) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: compErr.message })
    };
  }
  const companyMap = new Map(companies!.map(c => [c.name, Number(c.markup_pct)]));

  // 4) Genera pending_updates
  const updates: any[] = [];
  for (const rec of normalized!) {
    const { data: prod, error: prodErr } = await supabase
      .from('products')
      .select('*')
      .eq('minsan', rec.minsan)
      .single();
    if (prodErr || !prod) continue;

    const company = prod.shopify_sku.split('-')[0];
    const markup = companyMap.get(company) ?? 0;
    const newPrice = parseFloat(
      (prod.current_price * (1 + markup/100) * (1 + prod.vat_rate/100)).toFixed(2)
    );

    const diffQty   = rec.total_qty - prod.current_qty;
    const diffPrice = newPrice - prod.current_price;
    if (Math.abs(diffQty) > 0 || Math.abs(diffPrice) >= 0.01) {
      updates.push({
        import_id,
        staging_id: rec.id,
        product_id: prod.id,
        old_qty: prod.current_qty,
        new_qty: rec.total_qty,
        old_price: prod.current_price,
        new_price: newPrice,
        significant: true
      });
    }
  }

  const { error: insertErr } = await supabase
    .from('pending_updates')
    .insert(updates);
  if (insertErr) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: insertErr.message })
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates_count: updates.length })
  };
};
