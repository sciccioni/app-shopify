import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { meanBy } from 'lodash';

/* ---------- Supabase ---------------------------------------------------- */
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
);

/* ---------- Helpers ----------------------------------------------------- */
const col = (row: any, ...keys: string[]) =>
  keys.reduce<any>((val, k) => (val ?? row[k]), undefined);

/** Converte "7,04" → 7.04, "1.234,56" → 1234.56, "" → 0 */
const toNum = (value: any): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(
    String(value)
      .trim()
      .replace(/\./g, '')   // rimuove separatore migliaia
      .replace(',', '.')    // converte virgola in punto
  );
  return isNaN(n) ? 0 : n;
};

export const handler: Handler = async (event) => {
  const start = Date.now();

  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Only POST allowed' };

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

    /* 1️⃣  Righe grezze */
    const { data: raw, error: errRaw } = await supabase
      .from('imports_raw')
      .select('row_data')
      .eq('import_id', import_id);

    if (errRaw) throw errRaw;
    if (!raw?.length) {
      console.warn(`normalizeImport → no rows for import ${import_id}`);
      return { statusCode: 200, body: JSON.stringify({ success: false, rows: 0 }) };
    }
    console.log(`normalizeImport → ${raw.length} rows raw`);

    /* 2️⃣  Aggregazione per codice (Minsan/SKU) */
    const grouped: Record<string, any[]> = {};
    raw.forEach(({ row_data }) => {
      const r = row_data as any;
      const code = String(
        col(r, 'minsan', 'Minsan', 'MINSAN', 'sku', 'SKU', 'codice', 'Codice', 'CODICE') || ''
      )
        .trim()
        .replace(/^0+/, '');        // opz.: rimuove zeri iniziali
      if (!code) {
        console.warn('Row without code:', r);
        return;
      }
      grouped[code] = grouped[code] ? [...grouped[code], r] : [r];
    });

    const now = new Date().toISOString();
    const normalized = Object.entries(grouped).map(([sku, rows]) => {
      const giacenza    = rows.reduce(
        (s, r) => s + toNum(col(r, 'giacenza', 'Giacenza', 'GIACENZA')), 0);
      const costoMedio  = meanBy(rows, (r) =>
        toNum(col(r,
          'costo_medio', 'CostoMedio', 'COSTO_MEDIO',
          'prezzo_bd', 'PrezzoBD', 'PREZZO_BD')));
      const first = rows[0];

      return {
        import_id,
        minsan         : sku,
        ditta          : col(first, 'ditta', 'Ditta') ?? null,
        ean            : col(first, 'ean', 'EAN') ?? null,
        descrizione    : col(first, 'descrizione', 'Descrizione') ?? null,
        scadenza       : rows
          .filter(r => col(r, 'scadenza', 'Scadenza'))
          .sort((a, b) =>
            dayjs(col(a, 'scadenza', 'Scadenza')).valueOf() -
            dayjs(col(b, 'scadenza', 'Scadenza')).valueOf())[0]?.Scadenza ?? null,
        giacenza       : Math.max(Math.round(giacenza), 0),
        costo_medio    : Number(costoMedio.toFixed(4)),
        prezzo_bd      : toNum(col(first, 'prezzo_bd', 'PrezzoBD', 'PREZZO_BD')) || null,
        iva            : toNum(col(first, 'iva', 'IVA')) || null,
        prezzo_calcolato: null,    // calcolabile più avanti
        created_at     : now
      };
    });

    /* 3️⃣  Inserimento */
    await supabase.from('products').delete().eq('import_id', import_id);
    if (normalized.length) {
      const { error: insErr } = await supabase.from('products').insert(normalized);
      if (insErr) throw insErr;
    }

    await supabase
      .from('imports')
      .update({ status: 'normalized' })
      .eq('id', import_id);

    console.log(`normalizeImport → inserted ${normalized.length} rows – ${Date.now() - start} ms`);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, rows: normalized.length })
    };
  } catch (e: any) {
    console.error('Normalize error', e);
    return { statusCode: 500, body: e.message || 'Errore normalizzazione' };
  }
};
