import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { meanBy } from 'lodash';

/* ---------- Supabase ---------------------------------------------------- */
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,          // service-role key (bypasses RLS)
  { auth: { persistSession: false } }
);

/* ---------- Helpers ----------------------------------------------------- */
/** restituisce il primo campo definito tra gli alias passati */
const col = (row: any, ...keys: string[]) =>
  keys.reduce<any>((val, k) => (val ?? row[k]), undefined);

/** converte "1.234,56" → 1234.56, "7,04" → 7.04, valori vuoti → 0 */
const toNum = (v: any): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).trim().replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
};

export const handler: Handler = async (event) => {
  const t0 = Date.now();
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Only POST allowed' };

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id)
      return { statusCode: 400, body: 'import_id mancante' };

    /* 1️⃣  rows grezzi ---------------------------------------------------- */
    const { data: raw, error: errRaw } = await supabase
      .from('imports_raw')
      .select('row_data')
      .eq('import_id', import_id);

    if (errRaw) throw errRaw;
    if (!raw?.length) {
      console.warn(`normalizeImport → no rows for ${import_id}`);
      return { statusCode: 200, body: JSON.stringify({ success: false, rows: 0 }) };
    }
    console.log(`normalizeImport → ${raw.length} rows raw`);

    /* 2️⃣  carica markups ------------------------------------------------ */
    const { data: markups, error: errMarkups } = await supabase
      .from('company_markups')
      .select('company_name,markup_percentage');
    
    if (errMarkups) {
      console.error('Error loading markups:', errMarkups);
      throw errMarkups;
    }

    const markupMap = Object.fromEntries(
      (markups || []).map(m => [m.company_name, m.markup_percentage])
    );
    console.log(`normalizeImport → loaded ${Object.keys(markupMap).length} markups`);

    /* 3️⃣  aggrega per codice (Minsan/SKU) ------------------------------- */
    const grouped: Record<string, any[]> = {};
    raw.forEach(({ row_data }) => {
      const r   = row_data as any;
      const sku = String(
        col(r, 'minsan', 'Minsan', 'MINSAN', 'sku', 'SKU', 'codice', 'Codice', 'CODICE') || ''
      )
        .trim()
        .replace(/^0+/, '');           // opz.: rimuovo zeri iniziali
      if (!sku) {
        console.warn('normalizeImport → row without code', r);
        return;
      }
      grouped[sku] = grouped[sku] ? [...grouped[sku], r] : [r];
    });

    const now = new Date().toISOString();
    const normalized = Object.entries(grouped).map(([sku, rows]) => {
      const giacenza   = rows.reduce(
        (s, r) => s + toNum(col(r, 'giacenza', 'Giacenza', 'GIACENZA')), 0);
      const costoMedio = meanBy(rows, (r) =>
        toNum(col(r,
          'costo_medio', 'CostoMedio', 'COSTO_MEDIO',
          'prezzo_bd',   'PrezzoBD',   'PREZZO_BD')));
      const first = rows[0];

      /* scadenza più vicina */
      const scadCell = rows
        .map(r => col(r, 'scadenza', 'Scadenza'))
        .filter(Boolean)
        .sort((a, b) => dayjs(a).valueOf() - dayjs(b).valueOf())[0] ?? null;

      /* calcolo prezzo con markup */
      const ditta = col(first, 'ditta', 'Ditta') || '';
      const ivaPct = toNum(col(first, 'iva', 'IVA'));
      const markupPct = markupMap[ditta] ?? 0;
      const prezzoCalcolato = costoMedio > 0 
        ? Number((costoMedio * (1 + markupPct / 100) * (1 + ivaPct / 100)).toFixed(2))
        : null;

      return {
        import_id,
        minsan         : sku,
        ditta          : ditta || null,
        ean            : col(first, 'ean', 'EAN') || null,
        descrizione    : col(first, 'descrizione', 'Descrizione') || null,
        scadenza       : scadCell,
        giacenza       : Math.max(Math.round(giacenza), 0),
        costo_medio    : Number(costoMedio.toFixed(4)),
        prezzo_bd      : toNum(col(first, 'prezzo_bd', 'PrezzoBD', 'PREZZO_BD')) || null,
        iva            : ivaPct || null,
        prezzo_calcolato: prezzoCalcolato,
        created_at     : now
      };
    });

    /* 4️⃣  INSERT --------------------------------------------------------- */
    await supabase.from('products').delete().eq('import_id', import_id);

    let inserted = 0;
    if (normalized.length) {
      const { data: insData, error: insErr } =
        await supabase.from('products')
          .insert(normalized)
          .select('id');            // restituisce righe realmente salvate
      if (insErr) {
        console.error('INSERT error', insErr);
        throw insErr;
      }
      inserted = insData?.length || 0;
    }

    await supabase
      .from('imports')
      .update({ status: 'normalized' })
      .eq('id', import_id);

    console.log(`normalizeImport → saved ${inserted} / ${normalized.length} rows – ${Date.now() - t0} ms`);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, rows: inserted })
    };
  } catch (e: any) {
    console.error('Normalize error', e);
    return { statusCode: 500, body: e.message || 'Errore normalizzazione' };
  }
};
