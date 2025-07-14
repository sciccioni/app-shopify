import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import multipart from 'parse-multipart';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';

const SUPABASE_URL        = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY= process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1) estrai il body multipart
  const contentType = event.headers['content-type'] || event.headers['Content-Type']!;
  const boundary = multipart.getBoundary(contentType);
  const parts = multipart.Parse(Buffer.from(event.body!, 'base64'), boundary);

  // supponiamo che il file sia sempre il primo part
  const file = parts.find(p => p.filename);
  if (!file) {
    return { statusCode: 400, body: 'File mancante' };
  }

  // 2) leggi l’Excel in memoria
  const workbook = XLSX.read(file.data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });

  if (!json.length) {
    return { statusCode: 400, body: 'Excel vuoto' };
  }

  // 3) genera un import_id univoco
  const importId = randomUUID();

  // 4) prepara i record per Supabase
  const records = json.map(row => ({
    import_id: importId,
    minsan:     String(row['MINSAN'] || row['minsan'] || ''),
    batch:      row['batch'] || null,
    raw_quantity: parseInt(row['quantity'] || row['quantità'] || row['raw_quantity'], 10) || 0,
    raw_expiry: row['expiry'] ? new Date(row['expiry']) : null,
    raw_data:   row
  }));

  // 5) inserisci in blocco
  const { error } = await supabase
    .from('staging_inventory')
    .insert(records);

  if (error) {
    return { statusCode: 500, body: `DB Error: ${error.message}` };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      import_id: importId,
      rows_imported: records.length
    })
  };
};
