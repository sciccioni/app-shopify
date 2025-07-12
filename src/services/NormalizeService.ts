// src/services/NormalizeService.ts
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export class NormalizeService {
  static async run(importId: number) {
    const { data: imp } = await sb.from('imports_raw').select('import_data').eq('id', importId).single();
    const rows = imp.import_data as any[];
    // raggruppa per Minsan
    const grouped = rows.reduce((acc, r) => {
      acc[r.Minsan] = acc[r.Minsan]||[]; acc[r.Minsan].push(r);
      return acc;
    }, {} as Record<string, any[]>);

    const products = [];
    for (const [mins, recs] of Object.entries(grouped)) {
      // nearest expiry
      const dates = recs.map(r => new Date(r.Scadenza));
      const nearest = new Date(Math.min(...dates.map(d=>d.getTime())));
      // stock sum (negativi→0)
      const stock = recs.reduce((s,r)=> s + Math.max(0, Number(r.Giacenza)), 0);
      // costi
      const base = Math.avg(...recs.map(r=>Number(r.CostoBase)));
      const avg = Math.avg(...recs.map(r=>Number(r.CostoMedio)));
      // ultimo per Ditta
      const lastByCompany = recs.sort((a,b)=> new Date(b.DataUltimoCostoDitta).getTime() - new Date(a.DataUltimoCostoDitta).getTime())[0];
      products.push({ minsan: mins, nearest_expiry: nearest, total_stock: stock, costs: {
        base, avg, last_by_company: lastByCompany.UltimoCostoDitta, date_last_by_company: lastByCompany.DataUltimoCostoDitta
      }});
    }
    // salva tutti
    await sb.from('products').insert(products.map(p=>({ ...p, import_id: importId })));
  }
}
