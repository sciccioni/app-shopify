import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

interface MarkupUpdate {
  id: number;
  markup_percentage: number;
}

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
    const { markups } = JSON.parse(event.body || "{}") as { markups: MarkupUpdate[] };

    if (!markups || !Array.isArray(markups) || markups.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Nessun markup da aggiornare fornito." }) };
    }
    
    // Eseguiamo tutte le promesse di aggiornamento in parallelo
    const updatePromises = markups.map(markup => 
      supabase
        .from('company_markups')
        .update({ markup_percentage: markup.markup_percentage })
        .eq('id', markup.id)
    );

    const results = await Promise.all(updatePromises);

    // Controlla se ci sono stati errori individuali
    const errors = results.filter(res => res.error);
    if (errors.length > 0) {
        console.error("Errori durante l'aggiornamento di massa dei markup:", errors);
        throw new Error(`Impossibile aggiornare ${errors.length} record.`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `${markups.length} markup aggiornati con successo.` }),
    };
  } catch (error: any) {
    console.error("Errore durante l'aggiornamento di massa dei markup:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
