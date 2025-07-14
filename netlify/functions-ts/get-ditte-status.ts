import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const importId = event.queryStringParameters?.import_id;

    // 1. Prende tutti i markup già registrati
    const { data: markups, error: mError } = await supabase
      .from('company_markups')
      .select('id, ditta, markup_percentage')
      .order('ditta', { ascending: true });
    if (mError) throw mError;
    
    // Crea un Set per un confronto efficiente e case-insensitive
    const ditteConMarkup = new Set(markups?.map(m => m.ditta.toLowerCase().trim()) || []);

    let ditteMancanti: string[] = [];

    // 2. Se è stato fornito un importId, cerca le ditte nuove
    if (importId) {
        const { data: products, error: pError } = await supabase
          .from('products')
          .select('ditta')
          .eq('import_id', importId);
        if (pError) throw pError;

        // Estrae i nomi unici delle ditte, filtrando valori nulli o vuoti
        const importedDitte = [...new Set(products?.map(p => p.ditta).filter(Boolean) || [])];
        
        // Trova le ditte mancanti con un confronto case-insensitive
        ditteMancanti = importedDitte.filter(d => !ditteConMarkup.has(d.toLowerCase().trim()));
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markupsRegistrati: markups || [],
        ditteMancanti: ditteMancanti
      }),
    };
  } catch (error: any) {
    console.error("Errore nel recuperare lo stato delle ditte:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
