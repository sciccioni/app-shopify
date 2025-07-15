import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';

interface RawRow {
  minsan: string | number;
  ditta?: string;
  giacenza?: number;
  costo_medio?: number;
  prezzo_bd?: number;
  iva?: number;
  scadenza?: string | null;
  ean?: string | number;
  descrizione?: string;
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Only POST allowed' };
  }

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) {
      return { statusCode: 400, body: 'import_id mancante' };
    }

    /* 1️⃣ Legge le righe grezze */
    const { data: rawRows, error: rawError } = await supabase
      .from('imports_raw')
      .select('row_data')
      .eq('import_id', import_id);

    if (rawError) {
      console.error(rawError);
      return { statusCode: 500, body: 'Errore lettura imports_raw' };
    }

    /* 2️⃣ Aggrega per MINSAN */
    const aggregated: Record<string, RawRow & { giacenza: number; costo_medio: number }> = {};

    rawRows!.forEach(({ row_data }) => {
      const r: RawRow = row_data as RawRow;
      const key = String(r.minsan).trim();
      const qty = Number(r.giacenza ?? 0);
      const cost = Number(r.costo_medio ?? r.prezzo_bd ?? 0);

      if (!aggregated[key]) {
        aggregated[key] = { ...r, minsan: key, giacenza: 0, costo_medio: 0 };
      }

      const prevQty = aggregated[key].giacenza;
      aggregated[key].giacenza += qty;
      aggregated[key].costo_medio =
        prevQty + qty > 0
          ? (aggregated[key].costo_medio * prevQty + cost * qty) / (prevQty + qty)
          : cost;

      /* scadenza più vicina */
      if (r.scadenza) {
        const current = aggregated[key].scadenza;
        if (!current || dayjs(r.scadenza).isBefore(dayjs(current))) {
          aggregated[key].scadenza = r.scadenza;
        }
      }
    });

    /* 3️⃣ Recupera i markup */
    const { data: markups } = await supabase
      .from('company_markups')
      .select('company_name, markup_percentage');

    const now = new Date().toISOString();

    /* 4️⃣ Scrive in imports_normalized */
    const normalizedRows = Object.values(aggregated).map((row) => {
      const markupRow = markups?.find((m) => m.company_name === row.ditta);
      const markupPct = markupRow ? Number(markupRow.markup_percentage) : 0;
      const ivaPct = Number(row.iva ?? 0);

      const prezzo_calcolato =
        row.costo_medio * (1 + markupPct / 100) * (1 + ivaPct / 100);

      return {
        import_id,
        minsan: row.minsan,
        ditta: row.ditta ?? null,
        giacenza: Math.max(row.giacenza, 0),
        costo_medio: Number(row.costo_medio.toFixed(4)),
        prezzo_bd: row.prezzo_bd ?? null,
        iva: row.iva ?? null,
        scadenza: row.scadenza ?? null,
        ean: row.ean ?? null,
        descrizione: row.descrizione ?? null,
        prezzo_calcolato,
        created_at: now
      };
    });

    /* Pulisce eventuali normalizzazioni pregresse */
    await supabase.from('imports_normalized').delete().eq('import_id', import_id);
    const { error: insertError } = await supabase.from('imports_normalized').insert(normalizedRows);
    if (insertError) {
      console.error(insertError);
      return { statusCode: 500, body: 'Errore inserimento imports_normalized' };
    }

    await supabase.from('imports').update({ status: 'normalized' }).eq('id', import_id);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
    console.error('Normalize error', e);
    return { statusCode: 500, body: 'Errore interno normalizzazione' };
  }
};
