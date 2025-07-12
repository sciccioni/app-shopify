import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Interfaccia per i dati grezzi estratti da Supabase
interface RawProductData {
  id: number;
  import_id: string;
  row_data: {
    Minsan: string;
    EAN?: string;
    Ditta?: string;
    Descrizione?: string;
    Scadenza: string | Date; // Può essere stringa o data
    Lotto?: string;
    Giacenza: number;
    CostoMedio?: number;
    PrezzoBD?: number;
    IVA?: number;
  };
}

// Interfaccia per i prodotti normalizzati da inserire
interface NormalizedProduct {
  import_id: string;
  minsan: string;
  ean?: string;
  ditta?: string;
  descrizione?: string;
  scadenza?: string; // Formato YYYY-MM-DD
  giacenza: number;
  costo_medio?: number;
  prezzo_bd?: number;
  iva?: number;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Metodo non consentito." }),
    };
  }

  // 1. Estrai l'ID dell'importazione dal corpo della richiesta
  let importId: string;
  try {
    const body = JSON.parse(event.body || "{}");
    importId = body.importId;
    if (!importId) {
      throw new Error("importId non fornito nel corpo della richiesta.");
    }
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo della richiesta non valido o importId mancante." }) };
  }

  // 2. Inizializza Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente Supabase non configurate." }) };
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 3. Recupera tutti i dati grezzi per l'importazione specificata
    const { data: rawData, error: fetchError } = await supabase
      .from('imports_raw')
      .select('*')
      .eq('import_id', importId);

    if (fetchError) throw fetchError;
    if (!rawData || rawData.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Nessun dato grezzo trovato per questo importId." }) };
    }

    // 4. Raggruppa e normalizza i dati
    const normalizedMap = new Map<string, NormalizedProduct>();

    for (const rawProduct of rawData as RawProductData[]) {
      const { Minsan, Giacenza, Scadenza } = rawProduct.row_data;
      
      const existing = normalizedMap.get(Minsan);

      if (!existing) {
        // Se è la prima volta che vediamo questo Minsan, creiamo una nuova voce
        normalizedMap.set(Minsan, {
          import_id: importId,
          minsan: Minsan,
          ean: rawProduct.row_data.EAN,
          ditta: rawProduct.row_data.Ditta,
          descrizione: rawProduct.row_data.Descrizione,
          scadenza: new Date(Scadenza).toISOString().split('T')[0], // Converte in YYYY-MM-DD
          giacenza: Giacenza,
          costo_medio: rawProduct.row_data.CostoMedio,
          prezzo_bd: rawProduct.row_data.PrezzoBD,
          iva: rawProduct.row_data.IVA,
        });
      } else {
        // Se esiste già, aggreghiamo i valori
        // Somma algebrica della giacenza
        existing.giacenza += Giacenza;

        // Trova la data di scadenza più vicina
        const existingDate = new Date(existing.scadenza!);
        const newDate = new Date(Scadenza);
        if (newDate < existingDate) {
          existing.scadenza = newDate.toISOString().split('T')[0];
        }
      }
    }

    // 5. Finalizza i dati e prepara per l'inserimento
    const productsToInsert: NormalizedProduct[] = [];
    for (const product of normalizedMap.values()) {
      // Se la giacenza totale è negativa, impostala a 0 come richiesto
      if (product.giacenza < 0) {
        product.giacenza = 0;
      }
      productsToInsert.push(product);
    }
    
    // 6. Elimina vecchi dati normalizzati (se presenti) e inserisci i nuovi
    await supabase.from('products').delete().eq('import_id', importId);
    
    const { error: insertError } = await supabase
      .from('products')
      .insert(productsToInsert);

    if (insertError) throw insertError;

    // 7. Risposta di successo
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Dati normalizzati con successo.",
        importId: importId,
        uniqueProducts: productsToInsert.length,
      }),
    };

  } catch (error: any) {
    console.error("Errore durante la normalizzazione:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Errore interno del server." }),
    };
  }
};

export { handler };
