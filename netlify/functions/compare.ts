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

  // 1) Verifica vat_rate
  const { data: bad, error: vatErr } = await supabase
    .from('products')
    .select('minsan')
    .is('vat_rate', null);
  if (vatErr) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: vatErr.message })
    };
  }
  if (bad && bad.length) {
    const list = bad.map(p => p.minsan).join(', ');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Prodotti senza VAT: ${list}` })
    };
  }

  // 2) Leggi normalized_inventory
  const { data: norm, error: normErr } = await supabase
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

  // 3) Carica companies
  const { data: comps, error: compErr } = await supabase
    .from('companies')
    .select('name,markup_pct');
  if (compErr) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: compErr.message })
    };
  }
  const map = new Map(comps!.map(c => [c.name, Number(c.markup_pct)]));

  // 4) Costruisci pending_updates
  const updates: any[] = [];
  for (const r of norm || []) {
    const { data: p, error: pErr } = await supabase
      .from('products')
      .select('*')
      .eq('minsan', r.minsan)
      .single();
    if (pErr || !p) continue;
    const company = p.shopify_sku.split('-')[0];
    const markup = map.get(company) || 0;
    const newPrice = parseFloat(
      (p.current_price * (1 + markup/100) * (1 + p.vat_rate/100)).toFixed(2)
    );
    const diffQty = r.total_qty - p.current_qty;
    if (diffQty !== 0 || Math.abs(newPrice - p.current_price) >= 0.01) {
      updates.push({
        import_id,
        staging_id: r.id,
        product_id: p.id,
        old_qty: p.current_qty,
        new_qty: r.total_qty,
        old_price: p.current_price,
        new_price: newPrice,
        significant: true
      });
    }
  }

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

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates_count: updates.length })
  };
};
