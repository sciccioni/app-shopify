import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

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
    const { id, markup_percentage } = JSON.parse(event.body || "{}");

    if (!id || markup_percentage === undefined) {
      return { statusCode: 400, body: JSON.stringify({ error: "Dati mancanti: sono richiesti 'id' e 'markup_percentage'." }) };
    }
    
    const newMarkup = parseFloat(markup_percentage);
    if (isNaN(newMarkup)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Il markup deve essere un numero valido." }) };
    }

    const { data, error } = await supabase
      .from('company_markups')
      .update({ markup_percentage: newMarkup })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Markup aggiornato con successo.", updated: data }),
    };
  } catch (error: any) {
    console.error("Errore durante l'aggiornamento del markup:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno." }) };
  }
};

export { handler };
