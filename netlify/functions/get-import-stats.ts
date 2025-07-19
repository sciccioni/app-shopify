import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const handler: Handler = async (event) => {
    if (event.httpMethod !== "GET") {
        return { 
            statusCode: 405, 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: "Metodo non consentito." }) 
        };
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { 
            statusCode: 500, 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: "Variabili d'ambiente Supabase mancanti." }) 
        };
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const importId = event.queryStringParameters?.import_id;
    if (!importId) {
        return { 
            statusCode: 400, 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: "Parametro import_id mancante." }) 
        };
    }

    try {
        // Esegue tutte le query in parallelo per efficienza
        const [
            rawProductsResult,
            productsResult,
            pendingUpdatesResult,
            importedProductsResult,
            markupsResult
        ] = await Promise.all([
            supabase.from('raw_products').select('*', { count: 'exact', head: true }).eq('import_id', importId),
            supabase.from('products').select('*', { count: 'exact', head: true }).eq('import_id', importId),
            // MODIFICA: Ora recuperiamo tutti i dati delle modifiche, non solo il conteggio.
            supabase.from('pending_updates').select('*').eq('import_id', importId),
            supabase.from('products').select('ditta').eq('import_id', importId),
            supabase.from('company_markups').select('ditta')
        ]);

        // Controlla gli errori in modo più robusto
        const firstError = rawProductsResult.error || productsResult.error || pendingUpdatesResult.error || importedProductsResult.error || markupsResult.error;
        if (firstError) {
            throw firstError;
        }

        // Estrae i dati in modo più sicuro
        const totalRows = rawProductsResult.count ?? 0;
        const uniqueProductCount = productsResult.count ?? 0;
        const updates = pendingUpdatesResult.data ?? [];
        const productsToUpdate = updates.length; // Il conteggio è ora basato sui dati reali recuperati.
        const importedProducts = importedProductsResult.data;
        const markups = markupsResult.data;

        // Calcola le ditte nuove
        const importedDitte = new Set(importedProducts?.map(p => p.ditta).filter(d => d));
        const markupDitte = new Set(markups?.map(m => m.ditta));
        const newCompanies = [...importedDitte].filter(ditta => !markupDitte.has(ditta as string));

        const stats = {
            totalRows: totalRows,
            uniqueProductCount: uniqueProductCount,
            productsToUpdate: productsToUpdate,
            newCompanies: newCompanies
        };

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            // MODIFICA: La risposta ora include sia le statistiche che l'elenco delle modifiche.
            body: JSON.stringify({ stats, updates }),
        };

    } catch (error: any) {
        console.error("Errore in get-import-stats:", error);
        return { 
            statusCode: 500, 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message }) 
        };
    }
};

export { handler };
