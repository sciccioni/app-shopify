import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// --- NUOVA FUNZIONE HELPER ---
// Converte in modo sicuro un valore in un numero, gestendo le virgole.
const parseNumeric = (value: any): number | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const sanitized = value.replace(',', '.').trim();
        const num = parseFloat(sanitized);
        return isNaN(num) ? undefined : num;
    }
    const num = parseFloat(value);
    return isNaN(num) ? undefined : num;
};

interface RawProductData {
  Minsan: string;
  EAN?: string;
  Ditta?: string;
  Descrizione?: string;
  Scadenza: string | Date;
  Lotto?: string;
  Giacenza: number | string;
  CostoMedio?: number | string;
  PrezzoBD?: number | string;
  IVA?: number | string;
}

interface NormalizedProduct {
  import_id: string;
  minsan: string;
  ean?: string;
  ditta?: string;
  descrizione?: string;
  scadenza?: string;
  giacenza: number;
  costo_medio?: number;
  prezzo_bd?: number;
  iva?: number;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  let importId: string;
  try {
    const body = JSON.parse(event.body || "{}");
    importId = body.importId;
    if (!importId) throw new Error("importId non fornito.");
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo della richiesta non valido o importId mancante." }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente Supabase non configurate." }) };
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: rawData, error: fetchError } = await supabase
      .from('imports_raw')
      .select('row_data')
      .eq('import_id', importId);

    if (fetchError) throw fetchError;
    if (!rawData || rawData.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Nessun dato grezzo trovato per questo importId." }) };
    }

    const normalizedMap = new Map<string, NormalizedProduct>();

    for (const item of rawData) {
      const productData = item.row_data as RawProductData;
      const { Minsan, Giacenza, Scadenza } = productData;
      
      if (!Minsan) continue;

      const existing = normalizedMap.get(Minsan);

      let formattedDate: string | undefined;
      if (Scadenza) {
        const date = new Date(Scadenza);
        if (!isNaN(date.getTime())) {
            formattedDate = date.toISOString().split('T')[0];
        }
      }

      if (!existing) {
        normalizedMap.set(Minsan, {
          import_id: importId,
          minsan: Minsan,
          ean: productData.EAN,
          ditta: productData.Ditta,
          descrizione: productData.Descrizione,
          scadenza: formattedDate,
          giacenza: parseNumeric(Giacenza) || 0,
          costo_medio: parseNumeric(productData.CostoMedio),
          prezzo_bd: parseNumeric(productData.PrezzoBD),
          iva: parseNumeric(productData.IVA),
        });
      } else {
        existing.giacenza += parseNumeric(Giacenza) || 0;
        if (formattedDate && existing.scadenza && new Date(formattedDate) < new Date(existing.scadenza)) {
          existing.scadenza = formattedDate;
        } else if (formattedDate && !existing.scadenza) {
          existing.scadenza = formattedDate;
        }
      }
    }

    const productsToInsert = Array.from(normalizedMap.values());
    productsToInsert.forEach(p => { if (p.giacenza < 0) p.giacenza = 0; });
    
    if (productsToInsert.length > 0) {
      await supabase.from('products').delete().eq('import_id', importId);
      const { error: insertError } = await supabase.from('products').insert(productsToInsert);
      if (insertError) throw insertError;
    }

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
    // Restituisce un messaggio di errore più specifico al front-end
    const dbError = error as { details?: string; message?: string };
    const errorMessage = dbError.details || dbError.message || "Errore interno del server.";
    return {
      statusCode: 500,
      body: JSON.stringify({ error: errorMessage }),
    };
  }
};

export { handler };
