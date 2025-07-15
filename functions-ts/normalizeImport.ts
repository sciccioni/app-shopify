import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// Supabase client with service role
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

interface RawRow {
  Ditta: string;
  Minsan: string;
  EAN: string;
  Descrizione: string;
  Scadenza: string;    // ISO date string
  Lotto: string;
  Giacenza: number;
  CostoBase: number;
  CostoMedio: number;
  UltimoCostoDitta: number;
  DataUltimoCostoDitta: string; // ISO date string
  PrezzoBD: number;
  IVA: number;
}

interface Normalized {
  import_id: number;
  Ditta: string;
  Minsan: string;
  EAN: string;
  Descrizione: string;
  scadenza: string;
  lotto: string;
  giacenza_norm: number;
  costo_medio_norm: number;
  markup: number;
  prezzo_vendita: number;
  prezzo_barrato: number;
  IVA: number;
}

export const handler: Handler = async (event, context) => {
  try {
    const { import_id } = JSON.parse(event.body || '{}');
    if (!import_id) {
      return { statusCode: 400, body: 'import_id is required' };
    }

    // 1. Fetch raw rows
    const { data: raws, error: rawErr } = await supabase
      .from('imports_raw')
      .select('row_data')
      .eq('import_id', import_id);
    if (rawErr) throw rawErr;

    const parsed: RawRow[] = raws!.map(r => JSON.parse(r.row_data));

    // 2. Group by Ditta+Minsan
    const groups = parsed.reduce((acc, row) => {
      const key = `${row.Ditta}||${row.Minsan}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {} as Record<string, RawRow[]>);

    const normalized: Normalized[] = [];

    for (const key of Object.keys(groups)) {
      const rows = groups[key];
      const [Ditta, Minsan] = key.split('||');

      // Giacenza norma
      const totalGiac = rows.reduce((s, r) => s + r.Giacenza, 0);
      const giacenza_norm = Math.max(0, totalGiac);

      // Scadenza più vicina
      const scadenza = rows
        .map(r => new Date(r.Scadenza))
        .reduce((a, b) => (a < b ? a : b))
        .toISOString();

      // Media ponderata costo medio
      const sumWeighted = rows.reduce((s, r) => s + r.CostoMedio * r.Giacenza, 0);
      const costo_medio_norm = sumWeighted / (totalGiac || 1);

      // Lotto: prendi ultimo lotto (arbitrario)
      const lotto = rows[0].Lotto;

      // Fetch markup for company
      const { data: cm, error: cmErr } = await supabase
        .from('company_markups')
        .select('markup')
        .eq('Ditta', Ditta)
        .single();
      if (cmErr) throw cmErr;
      const markup = cm?.markup || 0;

      // Prezzi
      const IVA = rows[0].IVA;
      const prezzo_vendita = costo_medio_norm * (1 + markup / 100) * (1 + IVA / 100);
      const prezzo_barrato = rows[0].PrezzoBD;

      normalized.push({
        import_id,
        Ditta,
        Minsan,
        EAN: rows[0].EAN,
        Descrizione: rows[0].Descrizione,
        scadenza,
        lotto,
        giacenza_norm,
        costo_medio_norm,
        markup,
        prezzo_vendita,
        prezzo_barrato,
        IVA,
      });
    }

    // 3. Upsert into products
    const { error: upErr } = await supabase
      .from('products')
      .upsert(normalized.map(n => ({
        ...n,
        import_id: n.import_id
      })), { onConflict: ['import_id', 'Minsan', 'Ditta'] });
    if (upErr) throw upErr;

    return {
      statusCode: 200,
      body: JSON.stringify({ count: normalized.length })
    };
  } catch (err: any) {
    return { statusCode: 500, body: err.message };
  }
};
