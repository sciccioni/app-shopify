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
    // Decode base64 Excel file sent from frontend
    const binary = Buffer.from(file, 'base64');
    const workbook = XLSX.read(binary, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });

    // Inserisci import e raw rows in Supabase
    const { data: importRec } = await supabase
      .from('imports')
      .insert([{ file_name: 'upload.xlsx' }])
      .single();
    const import_id = importRec.id;

    const rows = jsonData.map((row: any) => ({ import_id, row_data: row }));
    await supabase.from('imports_raw').insert(rows);

    return { statusCode: 200, body: JSON.stringify({ import_id }) };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Upload failed' }) };
  }
};
