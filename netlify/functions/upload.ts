import { Handler } from '@netlify/functions';
import multipart from 'parse-multipart';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

// Variabili d'ambiente
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Estrazione del file Excel
  const boundary = multipart.getBoundary(event.headers['content-type'] || '');
  const bodyBuffer = Buffer.from(event.body || '', 'base64');
  const parts = multipart.Parse(bodyBuffer, boundary);
  const file = parts.find(p => p.filename && p.filename.endsWith('.xlsx'));
  if (!file) {
    return { statusCode: 400, body: 'No Excel file uploaded' };
  }

  // Lettura e conversione
  const workbook = XLSX.read(file.data);
  const sheetName = workbook.SheetNames[0];
  const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });

  // Import ID
  const importId = (await supabase.rpc('gen_random_uuid')).data;

  // Inserimento in staging_inventory
  const records = rows.map(r => ({
    import_id: importId,
    minsan: r.MINSAN,
    batch: r.Lotto || null,
    raw_quantity: r.Quantita ?? 0,
    raw_expiry: r.Scadenza ? new Date(r.Scadenza) : null,
    raw_data: r
  }));
  const { error } = await supabase.from('staging_inventory').insert(records);

  if (error) {
    return { statusCode: 500, body: `DB Error: ${error.message}` };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ import_id: importId, rows_imported: records.length })
  };
};
