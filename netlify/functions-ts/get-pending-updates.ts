import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// --- INTERFACCE PIÙ SPECIFICHE PER LA TIPizzazione ---

// Dettaglio di una singola modifica (valore vecchio e nuovo)
interface ChangeDetail {
  old: string | number | null;
  new: string | number;
}

// Struttura dell'oggetto JSONB nella colonna 'changes'
interface ChangesObject {
  quantity?: ChangeDetail;
  price?: ChangeDetail;
  cost?: ChangeDetail;
  expiry?: { new: string };
}

// Struttura completa dei dati che ci aspettiamo dalla tabella pending_updates
interface PendingUpdate {
  id: number;
  product_title: string;
  changes: ChangesObject; // Usiamo l'interfaccia specifica invece di 'any'
}

// Handler per recuperare le modifiche in sospeso
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  const importId = event.queryStringParameters?.import_id;
  if (!importId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Parametro import_id mancante." }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Seleziona le colonne corrette, inclusa 'changes'
    const { data: updates, error } = await supabase
      .from('pending_updates')
      .select('id, product_title, minsan, changes')
      .eq('import_id', importId)
      .returns<PendingUpdate[]>();

    if (error) throw error;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    };

  } catch (error: any) {
    console.error("Errore nel recuperare le modifiche:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno del server." }) };
  }
};

export { handler };
