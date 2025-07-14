import { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod !== "GET") return { statusCode: 405 };
    const importId = event.queryStringParameters?.import_id;
    if (!importId) return { statusCode: 400, body: JSON.stringify({ error: "import_id mancante" }) };

    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    try {
        const { data: products, error: pError } = await supabase.from('products').select('ditta').eq('import_id', importId);
        if (pError) throw pError;
        const { data: markups, error: mError } = await supabase.from('company_markups').select('ditta');
        if (mError) throw mError;

        const importedDitte = [...new Set(products?.map(p => p.ditta?.trim()).filter(Boolean) || [])];
        const configuredDitte = new Set(markups?.map(m => m.ditta.trim().toLowerCase()) || []);
        const newCompanies = importedDitte.filter(d => !configuredDitte.has(d.toLowerCase()));

        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newCompanies }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
