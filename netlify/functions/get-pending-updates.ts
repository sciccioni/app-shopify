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
        // Query per ottenere tutte le modifiche pendenti per un dato importId
        const { data, error } = await supabase
            .from('pending_updates')
            .select('*')
            .eq('import_id', importId);

        if (error) throw error;

        return {
            statusCode: 200,
            body: JSON.stringify({ updates: data }),
        };

    } catch (error: any) {
        console.error("Errore in get-pending-updates:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };
