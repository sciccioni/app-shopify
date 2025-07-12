import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Interfaccia per i dati grezzi estratti dal JSONB in Supabase
interface RawProductData {
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
}

// Interfaccia per i prodotti normalizzati da inserire nella tabella 'products'
interface NormalizedProduct {
  import_id: string;
  minsan: string;
  ean?: string;
  ditta?: string;
  descrizione?: string;
  scadenza?: string; // Verrà salvato in formato YYYY-MM-DD
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
      .select('row_data')
      .eq('import_id', importId);

    if (fetchError) throw fetchError;
    
    console.log(`Normalizzazione avviata per importId: ${importId}. Trovate ${rawData?.length || 0} righe grezze.`);

    if (!rawData || rawData.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Nessun dato grezzo trovato per questo importId." }) };
    }

    // 4. Raggruppa e normalizza i dati
    const normalizedMap = new Map<string, NormalizedProduct>();

    for (const item of rawData) {
      const productData = item.row_data as RawProductData;
      const { Minsan, Giacenza, Scadenza } = productData;
      
      if (!Minsan) {
        console.warn("Riga saltata: Minsan mancante.", productData);
        continue;
      }

      const existing = normalizedMap.get(Minsan);

      let formattedDate: string | undefined;
      try {
        if (Scadenza) {
            const date = new Date(Scadenza);
            // Verifica se la data è valida
            if (isNaN(date.getTime())) {
                throw new Error(`Formato data non valido: ${Scadenza}`);
            }
            formattedDate = date.toISOString().split('T')[0];
        }
      } catch (e: any) {
        console.warn(`(Minsan: ${Minsan}): Data di scadenza non valida ('${Scadenza}'). Verrà ignorata. Errore: ${e.message}`);
      }

      if (!existing) {
        // Se è la prima volta che vediamo questo Minsan, creiamo una nuova voce
        normalizedMap.set(Minsan, {
          import_id: importId,
          minsan: Minsan,
          ean: productData.EAN,
          ditta: productData.Ditta,
          descrizione: productData.Descrizione,
          scadenza: formattedDate,
          giacenza: Number(Giacenza) || 0,
          costo_medio: productData.CostoMedio,
          prezzo_bd: productData.PrezzoBD,
          iva: productData.IVA,
        });
      } else {
        // Se esiste già, aggreghiamo i valori
        existing.giacenza += Number(Giacenza) || 0;

        // Aggiorna la data di scadenza solo se la nuova data è valida e precedente a quella esistente
        if (formattedDate && existing.scadenza) {
            if (new Date(formattedDate) < new Date(existing.scadenza)) {
              existing.scadenza = formattedDate;
            }
        } else if (formattedDate && !existing.scadenza) {
            existing.scadenza = formattedDate;
        }
      }
    }

    console.log(`Mappa normalizzata creata con ${normalizedMap.size} prodotti unici.`);
    const productsToInsert = Array.from(normalizedMap.values());

    // 5. Finalizza i dati e prepara per l'inserimento
    for (const product of productsToInsert) {
      if (product.giacenza < 0) {
        product.giacenza = 0;
      }
    }
    
    if (productsToInsert.length > 0) {
      console.log(`Tentativo di inserire ${productsToInsert.length} prodotti nella tabella 'products'.`);
      
      // 6. Elimina vecchi dati normalizzati (se presenti) e inserisci i nuovi
      await supabase.from('products').delete().eq('import_id', importId);
      
      const { error: insertError } = await supabase
        .from('products')
        .insert(productsToInsert);

      if (insertError) throw insertError;
    } else {
      console.warn("Nessun prodotto da inserire dopo la normalizzazione. La tabella 'products' non verrà modificata.");
    }

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
    console.error("Errore dettagliato durante la normalizzazione:", JSON.stringify(error, null, 2));
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Errore interno del server." }),
    };
  }
};

export { handler };
