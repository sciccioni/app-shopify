import { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export const handler: Handler = async (event: HandlerEvent) => {
    if (event.httpMethod !== "POST") return { statusCode: 405 };
    
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    try {
        const { ditte } = JSON.parse(event.body || "{}");
        if (!ditte || !Array.isArray(ditte) || ditte.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: "Nessuna ditta fornita." }) };
        }
        const markupsToInsert = ditte.map(dittaName => ({ ditta: dittaName, markup_percentage: 20.00 }));
        const { data, error } = await supabase.from('company_markups').insert(markupsToInsert).select();
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ message: "Ditte aggiunte con successo.", count: data.length }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
