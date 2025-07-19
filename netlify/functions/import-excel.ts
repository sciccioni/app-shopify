import { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import xlsx from "xlsx";
import busboy from "busboy";

// Funzione per parsare il corpo della richiesta multipart/form-data
function parseMultipartForm(event: HandlerEvent): Promise<{ file: Buffer, filename: string }> {
    return new Promise((resolve, reject) => {
        const bb = busboy({ headers: event.headers as Record<string, string> });
        let fileBuffer: Buffer;
        let originalFilename: string;

        bb.on('file', (fieldname, file, info) => {
            const { filename } = info;
            originalFilename = filename;
            const chunks: Buffer[] = [];
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', () => fileBuffer = Buffer.concat(chunks));
        });

        bb.on('close', () => {
            if (fileBuffer) {
                resolve({ file: fileBuffer, filename: originalFilename });
            } else {
                reject(new Error("File non trovato nel form."));
            }
        });
        
        bb.on('error', err => reject(err));

        // Scrive il corpo della richiesta (che potrebbe essere codificato in base64) nel parser
        bb.write(Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'binary'));
        bb.end();
    });
}


const handler: Handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente Supabase mancanti." }) };
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    try {
        // 1. Parsa il file dal corpo della richiesta
        const { file } = await parseMultipartForm(event);

        // 2. Legge i dati dal buffer del file usando la libreria xlsx
        const workbook = xlsx.read(file, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data: Record<string, any>[] = xlsx.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: "Il file è vuoto o non formattato correttamente." }) };
        }

        // 3. Crea un ID unico per questa importazione
        const importId = uuidv4();

        // 4. Prepara i dati per l'inserimento in Supabase
        const rowsToInsert = data.map(row => ({
            import_id: importId,
            row_data: row,
        }));

        // 5. Salva i dati grezzi nella tabella 'raw_products'
        const { error } = await supabase.from('raw_products').insert(rowsToInsert);
        if (error) throw error;

        // 6. Restituisce l'ID dell'importazione al frontend
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "File importato con successo.",
                importId: importId,
                rowCount: data.length
            }),
        };

    } catch (error: any) {
        console.error("Errore in import-excel:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };
