import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
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

    bb.on('file', (fieldname: string, file: Readable, info: { filename: string; encoding: string; mimeType: string; }) => {
      const chunks: Buffer[] = [];
      file.on('data', (data: Buffer) => {
        chunks.push(data);
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('field', (fieldname: string, val: string) => {
      if (fieldname === 'password') {
        password = val;
      }
    });

    bb.on('finish', () => {
      if (!fileBuffer) {
        return reject(new Error("File non trovato nella richiesta."));
      }
      resolve({ file: fileBuffer, password });
    });
    
    bb.on('error', (err: Error) => {
        reject(err);
    });

    const body = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
    bb.end(body);
  });
};


const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const appPassword = process.env.APP_PASSWORD;

  if (!supabaseUrl || !supabaseServiceKey || !appPassword) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente non configurate." }) };
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { file, password } = await parseMultipartForm(event);

    if (password !== appPassword) {
      return { statusCode: 401, body: JSON.stringify({ error: "Password non valida." }) };
    }

    const workbook = xlsx.read(file, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = xlsx.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Il file Excel è vuoto." }) };
    }

    // --- LOGICA DI VALIDAZIONE AGGIORNATA E PIÙ ROBUSTA ---
    const headerOriginal = Object.keys(data[0]);
    // Pulisce gli header da spazi invisibili e li converte in minuscolo
    const headerCleaned = headerOriginal.map(h => h.trim().toLowerCase());

    const missingColumns = REQUIRED_COLUMNS.filter(
      reqCol => !headerCleaned.includes(reqCol.toLowerCase())
    );

    if (missingColumns.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Colonne mancanti nel file Excel: ${missingColumns.join(', ')}` }),
      };
    }

    // Creiamo una mappa per passare dai nomi originali a quelli puliti
    const headerMap: { [key: string]: string } = {};
    headerOriginal.forEach(h => {
        headerMap[h.trim().toLowerCase()] = h;
    });

    // Normalizziamo le chiavi di ogni riga per avere una struttura dati consistente
    const normalizedData = data.map(row => {
        const newRow: { [key: string]: any } = {};
        for (const requiredCol of REQUIRED_COLUMNS) {
            const originalColName = headerMap[requiredCol.toLowerCase()];
            if (originalColName) {
                newRow[requiredCol] = row[originalColName];
            }
        }
        return newRow;
    });
    // --- FINE LOGICA AGGIORNATA ---

    const { data: importData, error: importError } = await supabase
      .from('imports')
      .insert({ file_name: 'uploaded_file.xlsx' })
      .select()
      .single();

    if (importError) throw importError;

    const importId = importData.id;

    const rawDataToInsert = normalizedData.map(row => ({
      import_id: importId,
      row_data: row,
    }));

    const { error: rawDataError } = await supabase
      .from('imports_raw')
      .insert(rawDataToInsert);

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

  } catch (error: any) {
    console.error("Errore durante l'importazione:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Errore interno del server." }),
    };
  }
};

export { handler };
