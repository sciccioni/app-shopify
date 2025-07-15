import { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import busboy from "busboy";
import xlsx from "xlsx";
import { Readable } from "stream";

// Colonne obbligatorie che ci aspettiamo di trovare nel file Excel.
const REQUIRED_COLUMNS = [
  'Ditta', 'Minsan', 'EAN', 'Descrizione', 'Scadenza', 
  'Lotto', 'Giacenza', 'CostoBase', 'CostoMedio', 
  'UltimoCostoDitta', 'DataUltimoCostoDitta', 'PrezzoBD', 'IVA'
];

// Funzione per parsare il corpo della richiesta multipart/form-data
const parseMultipartForm = (event: HandlerEvent): Promise<{ file: Buffer, password?: string }> => {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: event.headers });
    let fileBuffer: Buffer | null = null;
    let password: string | undefined;

    bb.on('file', (fieldname: string, file: Readable) => {
      const chunks: Buffer[] = [];
      file.on('data', (data: Buffer) => chunks.push(data));
      file.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });
    bb.on('field', (fieldname: string, val: string) => { if (fieldname === 'password') password = val; });
    bb.on('finish', () => fileBuffer ? resolve({ file: fileBuffer, password }) : reject(new Error("File non trovato nella richiesta.")));
    bb.on('error', (err: Error) => reject(err));
    bb.end(Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8'));
  });
};

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  try {
    const { file, password } = await parseMultipartForm(event);
    if (password !== process.env.APP_PASSWORD) {
      return { statusCode: 401, body: JSON.stringify({ error: "Password non valida." }) };
    }

    const workbook = xlsx.read(file, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const data: any[] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (data.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Il file Excel è vuoto." }) };
    }

    // Validazione robusta che pulisce gli header da spazi extra
    const headerOriginal = Object.keys(data[0]);
    const headerCleaned = headerOriginal.map(h => h.trim().toLowerCase());
    const missingColumns = REQUIRED_COLUMNS.filter(reqCol => !headerCleaned.includes(reqCol.toLowerCase()));
    if (missingColumns.length > 0) {
      return { statusCode: 400, body: JSON.stringify({ error: `Colonne mancanti nel file Excel: ${missingColumns.join(', ')}` }) };
    }

    const headerMap: { [key: string]: string } = {};
    headerOriginal.forEach(h => { headerMap[h.trim().toLowerCase()] = h; });
    const normalizedData = data.map(row => {
        const newRow: { [key: string]: any } = {};
        for (const requiredCol of REQUIRED_COLUMNS) {
            const originalColName = headerMap[requiredCol.toLowerCase()];
            if (originalColName) newRow[requiredCol] = row[originalColName];
        }
        return newRow;
    });

    const { data: importData, error: importError } = await supabase.from('imports').insert({ file_name: 'uploaded_file.xlsx' }).select().single();
    if (importError) throw importError;
    const importId = importData.id;

    const rawDataToInsert = normalizedData.map(row => ({ import_id: importId, row_data: row }));
    const { error: rawDataError } = await supabase.from('imports_raw').insert(rawDataToInsert);
    if (rawDataError) {
      await supabase.from('imports').delete().eq('id', importId);
      throw rawDataError;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "File importato con successo!",
        importId: importId,
        rowsImported: normalizedData.length,
      }),
    };
  } catch (e: any) {
    console.error("Errore durante l'importazione:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Errore interno del server." }) };
  }
};
