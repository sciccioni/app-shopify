// src/services/ImportService.ts
import { createClient } from '@supabase/supabase-js';
import { parseXLSX } from '../utils/StreamingParser';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export class ImportService {
  static async run(buffer: Buffer) {
    // 1. valida colonne
    const required = ["Ditta","Minsan","EAN","Descrizione","Scadenza","Lotto","Giacenza","CostoBase","CostoMedio","UltimoCostoDitta","DataUltimoCostoDitta","PrezzoBD","IVA"];
    // parse header row to check
    // ... (omesso per brevità, usa ValidationService)

    // 2. crea import row
    const { data } = await sb.from('imports_raw').insert({ import_data: [] }).select('id').single();
    const importId = data.id;

    // 3. stream parsing e salvataggio raw
    const rows: any[] = [];
    await parseXLSX(buffer, row => {
      rows.push(row);
      return Promise.resolve();
    });
    await sb.from('imports_raw').update({ import_data: rows }).eq('id', importId);

    return importId;
  }
}
