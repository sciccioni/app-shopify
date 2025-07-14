import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Questa funzione confronta le ditte di un import con quelle esistenti e restituisce SOLO quelle nuove.
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
    const { data: products, error: pError } = await supabase.from('products').select('ditta').eq('import_id', importId);
    if (pError) throw pError;
    
    const { data: markups, error: mError } = await supabase.from('company_markups').select('ditta');
    if (mError) throw mError;

    const importedDitte = [...new Set(products?.map(p => p.ditta?.trim()).filter(Boolean) || [])];
    const configuredDitte = new Set(markups?.map(m => m.ditta.trim().toLowerCase()) || []);

    const newCompanies = importedDitte.filter(d => !configuredDitte.has(d.toLowerCase()));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newCompanies }),
    };
  } catch (error: any) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
