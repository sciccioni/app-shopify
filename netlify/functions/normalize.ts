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

  // 1) Legge le righe grezze da staging, usando i nomi esatti delle colonne
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
      raw_expiry AS scadenza,
    `)
    .eq('import_id', import_id);

  if (fetchErr) {
    return { statusCode: 500, body: JSON.stringify({ error: fetchErr.message }) };
  }

  // 2) Aggrega per MINSAN
  const map = new Map<string, any>();
  rows!.forEach(r => {
    const key = r.minsan;
    const qty = Number(r.raw_quantity) || 0;
    const expDate = r.scadenza ? new Date(r.scadenza) : null;

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
        expiry: r.scadenza
      });
    } else {
      const e = map.get(key);
      // somma algebrica
      e.total_qty += qty;
      // se questo lotto ha scadenza più recente, aggiorna expiry + campi
      if (expDate && new Date(e.expiry) < expDate) {
        e.expiry      = r.scadenza;
        e.costomedio  = r.costomedio;
        e.prezzo_bd   = r.prezzo_bd;
        e.iva         = r.iva;
        e.ditta       = r.ditta;
        e.ean         = r.ean;
        e.descrizione = r.descrizione;
      }
    }
  });

  // 3) Quantità negative → zero
  const aggregated = Array.from(map.values()).map((e: any) => ({
    ...e,
    total_qty: Math.max(0, e.total_qty)
  }));

  // 4) Sostituisci i normalized precedenti e inserisci i nuovi
  await supabase.from('normalized_inventory').delete().eq('import_id', import_id);
  const { error: insertErr } = await supabase
    .from('normalized_inventory')
    .insert(aggregated);

  if (insertErr) {
    return { statusCode: 500, body: JSON.stringify({ error: insertErr.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ import_id, rows: aggregated.length }) };
};
