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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Only POST allowed' };
  }

  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) return { statusCode: 400, body: 'import_id mancante' };

    /* 1. righe grezze */
    const { data: raw, error: errRaw } = await supabase
      .from('imports_raw')
      .select('row_data')
      .eq('import_id', import_id);
    if (errRaw) throw errRaw;

    /* 2. aggregazione per MINSAN */
    const group: Record<string, any[]> = {};
    raw!.forEach(({ row_data }) => {
      const r = row_data as any;
      const k = String(r.minsan).trim();
      group[k] = group[k] ? [...group[k], r] : [r];
    });

    /* 3. markup */
    const { data: markups } = await supabase
      .from('company_markups')
      .select('ditta, markup_percentage');

    const now = new Date().toISOString();
    const normalized = Object.entries(group).map(([minsan, rows]) => {
      const giacenza = rows.reduce((s, r) => s + Number(r.giacenza || 0), 0);
      const costo_medio = meanBy(rows, (r) => Number(r.costo_medio || r.prezzo_bd || 0));

      const first = rows[0];
      const ivaPct = Number(first.iva || 0);
      const markupPct =
        markups?.find((m) => m.ditta === first.ditta)?.markup_percentage || 0;

      return {
        import_id,
        minsan,
        ean: first.ean ?? null,
        ditta: first.ditta ?? null,
        descrizione: first.descrizione ?? null,
        scadenza: rows
          .filter((r) => r.scadenza)
          .sort((a, b) => dayjs(a.scadenza).valueOf() - dayjs(b.scadenza).valueOf())[0]?.scadenza ?? null,
        giacenza: Math.max(giacenza, 0),
        costo_medio: Number(costo_medio.toFixed(4)),
        prezzo_bd: first.prezzo_bd ?? null,
        prezzo_calcolato:
          costo_medio * (1 + markupPct / 100) * (1 + ivaPct / 100),
        iva: ivaPct,
        created_at: now
      };
    });

    await supabase.from('products').delete().eq('import_id', import_id);
    const { error: insErr } = await supabase.from('products').insert(normalized);
    if (insErr) throw insErr;

    await supabase.from('imports').update({ status: 'normalized' }).eq('id', import_id);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e: any) {
    console.error('Normalize error', e);
    return { statusCode: 500, body: e.message || 'Errore normalizzazione' };
  }
};
