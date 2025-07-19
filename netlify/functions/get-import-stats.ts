import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const handler: Handler = async (event) => {
    if (event.httpMethod !== "GET") {
        return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente Supabase mancanti." }) };
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const importId = event.queryStringParameters?.import_id;
    if (!importId) {
        return { statusCode: 400, body: JSON.stringify({ error: "Parametro import_id mancante." }) };
    }

    try {
        // Esegue tutte le query in parallelo per efficienza
        const [
            { count: totalRows },
            { count: uniqueProductCount },
            { count: productsToUpdate },
            { data: importedProducts, error: pError },
            { data: markups, error: mError }
        ] = await Promise.all([
            supabase.from('raw_products').select('*', { count: 'exact', head: true }).eq('import_id', importId),
            supabase.from('products').select('*', { count: 'exact', head: true }).eq('import_id', importId),
            supabase.from('pending_updates').select('*', { count: 'exact', head: true }).eq('import_id', importId),
            supabase.from('products').select('ditta').eq('import_id', importId),
            supabase.from('company_markups').select('ditta')
        ]);

        if (pError || mError) throw pError || mError;

        // Calcola le ditte nuove (presenti nell'import ma non nei markup)
        const importedDitte = new Set(importedProducts?.map(p => p.ditta));
        const markupDitte = new Set(markups?.map(m => m.ditta));
        const newCompanies = [...importedDitte].filter(ditta => !markupDitte.has(ditta));

        const stats = {
            totalRows: totalRows ?? 0,
            uniqueProductCount: uniqueProductCount ?? 0,
            productsToUpdate: productsToUpdate ?? 0,
            newCompanies: newCompanies
        };

        return {
            statusCode: 200,
            body: JSON.stringify({ stats }),
        };

    } catch (error: any) {
        console.error("Errore in get-import-stats:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };
