// netlify/functions/upload.ts
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import multipart from 'parse-multipart';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';

const SUPABASE_URL         = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 1) Estrai il multipart
  const contentType = event.headers['content-type'] || event.headers['Content-Type']!;
  const boundary = multipart.getBoundary(contentType);
  const parts = multipart.Parse(
    Buffer.from(event.body!, 'base64'),
    boundary
  );
  const filePart = parts.find(p => p.filename);
  if (!filePart) {
    return { statusCode: 400, body: 'File mancante' };
  }

  // 2) Leggi l’Excel
  const wb = XLSX.read(filePart.data, { type: 'buffer', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });

  if (!raw.length) {
    return { statusCode: 400, body: 'Excel vuoto' };
  }

  // 3) Pulizia header: tutte le chiavi in minuscolo
  const json = raw.map(row => {
    const obj: Record<string, any> = {};
    for (const k of Object.keys(row)) {
      obj[k.trim().toLowerCase()] = row[k];
    }
    return obj;
  });

  // 4) Genera import_id
  const importId = randomUUID();

  // 5) Mappa i campi chiave
  const records = json.map(r => ({
    import_id:    importId,
    minsan:       String(r['minsan'] || ''),
    batch:        r['lotto']    || null,
    // r['giacenza'] può essere number o stringa "6"
    raw_quantity: Number(r['giacenza'] ?? 0),
    // r['scadenza'] può essere Date o stringa "2026-03-31"
    raw_expiry:   r['scadenza']
                   ? (r['scadenza'] instanceof Date 
                      ? r['scadenza'] 
                      : new Date(r['scadenza']))
                   : null,
    raw_data:     r
  }));

  // 6) Bulk insert su Supabase
  const { error } = await supabase
    .from('staging_inventory')
    .insert(records);

  if (error) {
    return { statusCode: 500, body: `DB Error: ${error.message}` };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      import_id:     importId,
      rows_imported: records.length
    })
  };
};
