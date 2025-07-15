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

/* ---------- Helper alias ------------------------------------------------ */
const col = (row: any, ...keys: string[]) =>
  keys.reduce<any>((val, k) => (val ?? row[k]), undefined);

export const handler: Handler = async (event) => {
  const t0 = Date.now();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Only POST allowed' };
  }

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

    /* 1️⃣  Righe grezze */
    const { data: raw, error: errRaw } = await supabase
      .from('imports_raw')
      .select('row_data')
      .eq('import_id', import_id);

    if (errRaw) throw errRaw;
    if (!raw || !raw.length) {
      console.warn(`normalizeImport → nessuna riga raw per import_id ${import_id}`);
      return { statusCode: 200, body: JSON.stringify({ success: false, rows: 0 }) };
    }
    console.log(`normalizeImport → ${raw.length} righe raw lette`);

    /* 2️⃣  Aggregazione per MINSAN / SKU --------------------------------- */
    const grouped: Record<string, any[]> = {};

    raw.forEach(({ row_data }) => {
      const r   = row_data as any;
      const sku = String(
        col(r, 'minsan', 'Minsan', 'MINSAN', 'sku', 'SKU', 'codice', 'Codice', 'CODICE') || ''
      )
        .trim()
        .replace(/^0+/, '');          // opz.: rimuove zeri iniziali

      if (!sku) {
        console.warn('Riga senza codice:', r);
        return;
      }
      grouped[sku] = grouped[sku] ? [...grouped[sku], r] : [r];
    });

    const now = new Date().toISOString();
    const normalized = Object.entries(grouped).map(([sku, rows]) => {
      const giacenza    = rows.reduce((s: number, r: any) =>
        s + Number(col(r, 'giacenza', 'Giacenza', 'GIACENZA') || 0), 0);

      const costoMedio  = meanBy(rows, (r: any) =>
        Number(col(r, 'costo_medio', 'CostoMedio', 'COSTO_MEDIO', 'prezzo_bd', 'PrezzoBD', 'PREZZO_BD') || 0));

      const first = rows[0];

      return {
        import_id,
        minsan         : sku,
        ditta          : col(first, 'ditta', 'Ditta')        ?? null,
        ean            : col(first, 'ean', 'EAN')            ?? null,
        descrizione    : col(first, 'descrizione', 'Descrizione') ?? null,
        scadenza       : rows
          .filter((r: any) => col(r, 'scadenza', 'Scadenza'))
          .sort((a: any, b: any) =>
            dayjs(col(a, 'scadenza', 'Scadenza')).valueOf() -
            dayjs(col(b, 'scadenza', 'Scadenza')).valueOf())[0]?.Scadenza ?? null,
        giacenza       : Math.max(giacenza, 0),
        costo_medio    : Number(costoMedio.toFixed(4)),
        prezzo_bd      : col(first, 'prezzo_bd', 'PrezzoBD', 'PREZZO_BD') ?? null,
        iva            : col(first, 'iva', 'IVA') ?? null,
        prezzo_calcolato: null,         // verrà calcolato in step successivo se serve
        created_at     : now
      };
    });

    /* 3️⃣  Inserisce in products ---------------------------------------- */
    await supabase.from('products').delete().eq('import_id', import_id);
    if (normalized.length) {
      const { error: insErr } = await supabase.from('products').insert(normalized);
      if (insErr) throw insErr;
    }

    await supabase
      .from('imports')
      .update({ status: 'normalized' })
      .eq('id', import_id);

    console.log(`normalizeImport → inserite ${normalized.length} righe in products – ${Date.now() - t0} ms`);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, rows: normalized.length })
    };
  } catch (e: any) {
    console.error('Normalize error', e);
    return { statusCode: 500, body: e.message || 'Errore normalizzazione' };
  }
};
