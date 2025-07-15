import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { meanBy } from 'lodash';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

export const handler: Handler = async (event) => {
  const start = Date.now();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Only POST allowed' };
  }

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

    /* 1️⃣ Legge le righe grezze */
    const { data: raw, error: errRaw, count } = await supabase
      .from('imports_raw')
      .select('row_data', { count: 'exact' })
      .eq('import_id', import_id);

    if (errRaw) throw errRaw;
    if (!raw || raw.length === 0) {
      console.warn(`normalizeImport → import_id ${import_id} senza righe grezze`);
      return { statusCode: 200, body: JSON.stringify({ success: false, rows: 0 }) };
    }
    console.log(`normalizeImport → ${count} righe raw lette`);

    /* 2️⃣ Aggrega per MINSAN */
    const group: Record<string, any[]> = {};
    raw.forEach(({ row_data }) => {
      const r = row_data as any;
      const key = String(r.minsan ?? r.MINSAN ?? '').trim();
      if (!key) return;
      group[key] = group[key] ? [...group[key], r] : [r];
    });

    const now = new Date().toISOString();
    const normalized = Object.entries(group).map(([minsan, rows]) => {
      const giacenza    = rows.reduce((s, r) => s + Number(r.giacenza ?? r.GIACENZA ?? 0), 0);
      const costo_medio = meanBy(rows, (r) => Number(r.costo_medio ?? r.COSTO_MEDIO ?? r.prezzo_bd ?? r.PREZZO_BD ?? 0));
      const first       = rows[0];

      return {
        import_id,
        minsan,
        ditta       : first.ditta       ?? first.DITTA      ?? null,
        ean         : first.ean         ?? first.EAN        ?? null,
        descrizione : first.descrizione ?? first.DESCRIZIONE?? null,
        scadenza    : rows
          .filter((r) => r.scadenza || r.SCADENZA)
          .sort((a, b) => dayjs(a.scadenza ?? a.SCADENZA).valueOf() - dayjs(b.scadenza ?? b.SCADENZA).valueOf())[0]?.scadenza ?? null,
        giacenza    : Math.max(giacenza, 0),
        costo_medio : Number(costo_medio.toFixed(4)),
        prezzo_bd   : first.prezzo_bd   ?? first.PREZZO_BD  ?? null,
        iva         : first.iva         ?? first.IVA        ?? null,
        prezzo_calcolato: null,               // calcolato in un secondo step se serve
        created_at  : now
      };
    });

    /* 3️⃣ Inserisce in products */
    await supabase.from('products').delete().eq('import_id', import_id);
    if (normalized.length) {
      const { error: insErr } = await supabase.from('products').insert(normalized);
      if (insErr) throw insErr;
    }

    await supabase.from('imports')
      .update({ status: 'normalized' })
      .eq('id', import_id);

    console.log(`normalizeImport → ${normalized.length} righe inserite in products, tempo ${Date.now() - start} ms`);
    return { statusCode: 200, body: JSON.stringify({ success: true, rows: normalized.length }) };
  } catch (e: any) {
    console.error('Normalize error', e);
    return { statusCode: 500, body: e.message || 'Errore normalizzazione' };
  }
};
