import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

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
    // 1. Prende tutte le ditte uniche dall'ultimo import
    const { data: products, error: pError } = await supabase
      .from('products')
      .select('ditta')
      .eq('import_id', importId);

    if (pError) throw pError;
    const importedDitte = [...new Set(products?.map(p => p.ditta).filter(Boolean) || [])];

    // 2. Prende tutti i markup già registrati
    const { data: markups, error: mError } = await supabase
      .from('company_markups')
      .select('id, ditta, markup_percentage')
      .order('ditta', { ascending: true });
      
    if (mError) throw mError;
    const ditteConMarkup = markups?.map(m => m.ditta) || [];

    // 3. Confronta le liste per trovare le ditte mancanti
    const ditteMancanti = importedDitte.filter(d => !ditteConMarkup.includes(d));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markupsRegistrati: markups,
        ditteMancanti: ditteMancanti
      }),
    };
  } catch (error: any) {
    console.error("Errore nel recuperare lo stato delle ditte:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
