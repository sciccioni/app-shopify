import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  // 1. Estrai l'ID dell'importazione dai parametri della query URL
  const importId = event.queryStringParameters?.import_id;
  if (!importId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Parametro import_id mancante." }) };
  }

  // 2. Inizializza Supabase
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // 3. Recupera le modifiche in sospeso dal database
    const { data: updates, error } = await supabase
      .from('pending_updates')
      .select('id, product_title, field, old_value, new_value')
      .eq('import_id', importId);

    if (error) throw error;

    // 4. Restituisci i dati
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
