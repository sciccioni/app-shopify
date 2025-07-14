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
    const b = JSON.parse(event.body || '{}');
    import_id = b.import_id;
    if (!import_id) throw new Error('import_id mancante');
  } catch (err: any) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }

  // 1) Carica la normalized_inventory
  const { data: norm, error: normErr } = await supabase
    .from('normalized_inventory')
    .select('id, minsan, total_qty')
    .eq('import_id', import_id);
  if (normErr) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: normErr.message })
    };
  }
  const minsans = norm!.map(r => r.minsan);
  if (!minsans.length) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates_count: 0 })
    };
  }

  // 2) Carica in bulk tutti i prodotti corrispondenti
  const { data: prods, error: prodErr } = await supabase
    .from('products')
    .select('id, minsan, shopify_sku, current_qty, current_price, vat_rate')
    .in('minsan', minsans);
  if (prodErr) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: prodErr.message })
    };
  }
  // Mappa minsan → prodotto
  const prodMap = new Map(prods!.map(p => [p.minsan, p]));

  // 3) Carica i markup in bulk
  const { data: comps, error: compErr } = await supabase
    .from('companies')
    .select('name, markup_pct');
  if (compErr) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: compErr.message })
    };
  }
  const markupMap = new Map(comps!.map(c => [c.name, Number(c.markup_pct)]));

  // 4) Costruisci array di pending_updates
  const updates: any[] = norm!.flatMap(r => {
    const p = prodMap.get(r.minsan);
    if (!p) return [];
    // estrai il “prefix” ditta dallo SKU (prima parte)
    const company = p.shopify_sku.split('-')[0];
    const markup = markupMap.get(company) || 0;
    const newPrice = parseFloat(
      (p.current_price * (1 + markup/100) * (1 + p.vat_rate/100)).toFixed(2)
    );
    const diffQty   = r.total_qty - p.current_qty;
    const diffPrice = newPrice - p.current_price;
    if (diffQty === 0 && Math.abs(diffPrice) < 0.01) return [];
    return {
      import_id,
      staging_id: r.id,
      product_id: p.id,
      old_qty:    p.current_qty,
      new_qty:    r.total_qty,
      old_price:  p.current_price,
      new_price:  newPrice,
      significant: true
    };
  });

  // 5) Bulk insert
  if (updates.length) {
    const { error: insErr } = await supabase
      .from('pending_updates')
      .insert(updates);
    if (insErr) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: insErr.message })
      };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates_count: updates.length })
  };
};
