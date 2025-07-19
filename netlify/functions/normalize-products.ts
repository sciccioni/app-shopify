import { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// Definisce la struttura di un prodotto normalizzato
interface LocalProduct {
    import_id: string;
    minsan: string;
    ditta: string;
    iva: number;
    giacenza: number;
    costo_medio?: number;
    prezzo_bd?: number;
    scadenza?: string;
}

const handler: Handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente Supabase mancanti." }) };
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let importId: string;
    try {
        const body = JSON.parse(event.body || "{}");
        importId = body.importId;
        if (!importId) throw new Error("importId non fornito.");
    } catch (error) {
        return { statusCode: 400, body: JSON.stringify({ error: "Corpo della richiesta non valido." }) };
    }

    try {
        // 1. Recupera tutti i dati grezzi per l'importId specificato
        const { data: rawProducts, error: fetchError } = await supabase
            .from('raw_products')
            .select('row_data')
            .eq('import_id', importId);

        if (fetchError) throw fetchError;
        if (!rawProducts || rawProducts.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ error: "Nessun dato grezzo trovato per questo importId." }) };
        }

        // 2. Normalizza e aggrega i dati
        const normalizedMap = new Map<string, LocalProduct>();

        for (const item of rawProducts) {
            const row = item.row_data;
            const minsan = String(row.Minsan || row.minsan || '').trim();
            if (!minsan) continue; // Salta le righe senza Minsan

            // Converte i valori numerici, gestendo formati con la virgola
            const giacenza = parseInt(String(row.Giacenza || row.giacenza || 0), 10);
            const costoMedio = parseFloat(String(row.CostoMedio || row.costo_medio || 0).replace(',', '.'));
            const prezzoBd = parseFloat(String(row.PrezzoBD || row.prezzo_bd || 0).replace(',', '.'));
            const iva = parseFloat(String(row.IVA || row.iva || 0).replace(',', '.'));

            if (normalizedMap.has(minsan)) {
                // Se il prodotto esiste già, aggiorna la giacenza
                const existing = normalizedMap.get(minsan)!;
                existing.giacenza += giacenza;
            } else {
                // Altrimenti, crea un nuovo prodotto normalizzato
                normalizedMap.set(minsan, {
                    import_id: importId,
                    minsan: minsan,
                    ditta: String(row.Ditta || row.ditta || ''),
                    iva: isNaN(iva) ? 0 : iva,
                    giacenza: isNaN(giacenza) ? 0 : giacenza,
                    costo_medio: isNaN(costoMedio) ? undefined : costoMedio,
                    prezzo_bd: isNaN(prezzoBd) ? undefined : prezzoBd,
                    scadenza: row.Scadenza || row.scadenza,
                });
            }
        }

        const productsToInsert = Array.from(normalizedMap.values());

        // 3. Salva i prodotti normalizzati nella tabella 'products'
        const { error: insertError } = await supabase.from('products').insert(productsToInsert);
        if (insertError) throw insertError;
        
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Prodotti normalizzati con successo.", count: productsToInsert.length }),
        };

    } catch (error: any) {
        console.error("Errore in normalize-products:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export { handler };
