// netlify/functions/normalize.ts
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const handler: Handler = async (event) => {
  const { import_id } = JSON.parse(event.body || '{}');
  if (!import_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'import_id mancante' }) };
  }

  // 1) Leggo i campi dal raw, inclusi raw_expiry (senza alias)
  const { data: rows, error: fetchErr } = await supabase
    .from('staging_inventory')
    .select(`
      ditta,
      minsan,
      ean,
      descrizione,
      lotto,
      raw_quantity,
      costo_base,
      costomedio,
      prezzo_bd,
      iva,
      data_ultimo_costo_ditta,
      raw_expiry
    `)
    .eq('import_id', import_id);

  if (fetchErr) {
    return { statusCode: 500, body: JSON.stringify({ error: fetchErr.message }) };
  }

  // 2) Aggrego per MINSAN, usando raw_expiry come expiry
  const map = new Map<string, any>();
  rows!.forEach(r => {
    const key = r.minsan;
    const qty = Number(r.raw_quantity) || 0;
    const expDate = r.raw_expiry ? new Date(r.raw_expiry) : null;

    if (!map.has(key)) {
      map.set(key, {
        import_id,
        ditta: r.ditta,
        minsan: key,
        ean: r.ean,
        descrizione: r.descrizione,
        total_qty: qty,
        costomedio: r.costomedio,
        prezzo_bd: r.prezzo_bd,
        iva: r.iva,
        expiry: r.raw_expiry  // uso direttamente raw_expiry
      });
    } else {
      const e = map.get(key);
      e.total_qty += qty;
      if (expDate && new Date(e.expiry) < expDate) {
        e.expiry      = r.raw_expiry;
        e.costomedio  = r.costomedio;
        e.prezzo_bd   = r.prezzo_bd;
        e.iva         = r.iva;
        e.ditta       = r.ditta;
        e.ean         = r.ean;
        e.descrizione = r.descrizione;
      }
    }
  });

  // 3) Evito qty negative
  const aggregated = Array.from(map.values()).map((e: any) => ({
    ...e,
    total_qty: Math.max(0, e.total_qty)
  }));

  // 4) Sostituisco in normalized_inventory
  await supabase.from('normalized_inventory').delete().eq('import_id', import_id);
  const { error: insertErr } = await supabase
    .from('normalized_inventory')
    .insert(aggregated);

  if (insertErr) {
    return { statusCode: 500, body: JSON.stringify({ error: insertErr.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ import_id, rows: aggregated.length }) };
};
