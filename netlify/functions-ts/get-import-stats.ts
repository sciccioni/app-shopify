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
    // Eseguiamo tutte le query necessarie in parallelo per efficienza
    const [
      rawCountResult,
      productsResult,
      pendingUpdatesResult,
      markupsResult
    ] = await Promise.all([
      supabase.from('imports_raw').select('id', { count: 'exact', head: true }).eq('import_id', importId),
      supabase.from('products').select('ditta, minsan').eq('import_id', importId),
      supabase.from('pending_updates').select('minsan', { count: 'exact', head: true }).eq('import_id', importId),
      supabase.from('company_markups').select('ditta')
    ]);

    // Estrai i dati e gestisci eventuali errori
    const totalRows = rawCountResult.count || 0;
    const uniqueProducts = productsResult.data || [];
    const pendingUpdateCount = pendingUpdatesResult.count || 0;
    const configuredMarkups = markupsResult.data?.map(m => m.ditta) || [];

    const importedDitte = [...new Set(uniqueProducts.map(p => p.ditta).filter(Boolean))];
    const productsFoundOnShopify = [...new Set(uniqueProducts.map(p => p.minsan))];

    const newCompanies = importedDitte.filter(d => !configuredMarkups.includes(d));

    const stats = {
      totalRows,
      uniqueProductCount: uniqueProducts.length,
      productsFoundOnShopify: productsFoundOnShopify.length,
      productsToUpdate: pendingUpdateCount,
      newCompanies: newCompanies
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stats }),
    };

  } catch (error: any) {
    console.error("Errore nel recuperare le statistiche:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
