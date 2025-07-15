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

  // 1) Legge tutte le righe di staging
  const { data: rows, error: fetchErr } = await supabase
    .from('staging_inventory')
    .select('minsan, giacenza, scadenza, costomedio, prezzo_bd, iva, ditta')
    .eq('import_id', import_id);

  if (fetchErr) {
    return { statusCode: 500, body: JSON.stringify({ error: fetchErr.message }) };
  }

  // 2) Aggrega per MINSAN
  const map = new Map<string, any>();
  rows!.forEach(r => {
    const key = r.minsan;
    const qty = Number(r.giacenza) || 0;
    const expDate = r.scadenza ? new Date(r.scadenza) : null;
    if (!map.has(key)) {
      map.set(key, {
        import_id,
        minsans: key,
        total_qty: qty,
        expiry: r.scadenza,
        costomedio: r.costomedio,
        prezzo_bd: r.prezzo_bd,
        iva: r.iva,
        ditta: r.ditta
      });
    } else {
      const e = map.get(key);
      // somma algebrica delle giacenze
      e.total_qty += qty;
      // sceglie la data di scadenza più recente
      if (expDate && new Date(e.expiry) < expDate) {
        e.expiry      = r.scadenza;
        e.costomedio  = r.costomedio;
        e.prezzo_bd   = r.prezzo_bd;
        e.iva         = r.iva;
        e.ditta       = r.ditta;
      }
    }
  });

  // 3) Normalizza le quantità negative a zero
  const aggregated = Array.from(map.values()).map((e: any) => ({
    ...e,
    total_qty: Math.max(0, e.total_qty)
  }));

  // 4) Pulisce i vecchi record e inserisce i nuovi
  await supabase.from('normalized_inventory').delete().eq('import_id', import_id);
  const { error: insertErr } = await supabase
    .from('normalized_inventory')
    .insert(aggregated);

  if (insertErr) {
    return { statusCode: 500, body: JSON.stringify({ error: insertErr.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ import_id, rows: aggregated.length }) };
};
