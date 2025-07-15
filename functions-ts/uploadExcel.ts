import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Only POST allowed' };
  }

  try {
    const { file } = JSON.parse(event.body || '{}');
    if (!file) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Nessun file ricevuto' }),
      };
    }

    // Decode base64 Excel file
    const binary = Buffer.from(file, 'base64');
    const workbook = XLSX.read(binary, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });

    // 1) Inserimento record import
    const { data: importRec, error: importError } = await supabase
      .from('imports')
      .insert([{ file_name: 'upload.xlsx' }])
      .single();

    if (importError || !importRec) {
      console.error('Import insert error:', importError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Errore creazione import record' }),
      };
    }
    const import_id = importRec.id;

    // 2) Inserimento righe raw
    const rows = jsonData.map((row: any) => ({ import_id, row_data: row }));
    const { error: rawError } = await supabase.from('imports_raw').insert(rows);

    if (rawError) {
      console.error('Raw rows insert error:', rawError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Errore inserimento righe raw' }),
      };
    }

    // Success
    return {
      statusCode: 200,
      body: JSON.stringify({ import_id }),
    };

  } catch (error) {
    console.error('Upload handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Upload failed' }),
    };
  }
};
