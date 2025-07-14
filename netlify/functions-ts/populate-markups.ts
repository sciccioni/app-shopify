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
    // --- CORREZIONE: Legge l'importId dal corpo della richiesta ---
    const { importId } = JSON.parse(event.body || "{}");
    if (!importId) {
      return { statusCode: 400, body: JSON.stringify({ error: "ID importazione non fornito." }) };
    }

    // 1. Recupera le ditte uniche DALL'IMPORTAZIONE SPECIFICA
    const { data: products, error: fetchError } = await supabase
      .from('products')
      .select('ditta')
      .eq('import_id', importId);

    if (fetchError) throw fetchError;
    if (!products || products.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: "Nessun prodotto trovato da cui estrarre le ditte." }) };
    }

    const uniqueDitte = [...new Set(products.map(p => p.ditta).filter(Boolean))];

    if (uniqueDitte.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ message: "Nessuna ditta valida trovata nei prodotti." }) };
    }

    // 2. Prepara i dati da inserire con un markup di default (es. 20%)
    const markupsToInsert = uniqueDitte.map(dittaName => ({
      ditta: dittaName,
      markup_percentage: 20.00 // Un valore di default ragionevole
    }));

    // 3. Inserisci i nuovi markup, ignorando i duplicati
    const { data, error: upsertError } = await supabase
      .from('company_markups')
      .upsert(markupsToInsert, { onConflict: 'ditta', ignoreDuplicates: true })
      .select();

    if (upsertError) throw upsertError;

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Tabella markup popolata con successo.",
        ditteAggiunte: data?.length || 0,
        ditteAnalizzate: uniqueDitte.length
      }),
    };

  } catch (error: any) {
    console.error("Errore durante il popolamento dei markup:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno del server." }) };
  }
};

export { handler };
