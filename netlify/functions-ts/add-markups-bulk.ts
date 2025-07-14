import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Questa funzione aggiunge una lista di nuove ditte con un markup di default.
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { ditte } = JSON.parse(event.body || "{}");
    if (!ditte || !Array.isArray(ditte) || ditte.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "Nessuna ditta fornita." }) };
    }

    const markupsToInsert = ditte.map(dittaName => ({
      ditta: dittaName,
      markup_percentage: 20.00 // Markup di default
    }));

    const { data, error } = await supabase
      .from('company_markups')
      .insert(markupsToInsert)
      .select();

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Ditte aggiunte con successo.", count: data.length }),
    };
  } catch (error: any) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
