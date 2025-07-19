import { Handler, HandlerEvent } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE ---
// Definisce la struttura di un prodotto locale dopo la normalizzazione
interface LocalProduct {
  minsan: string;
  ditta: string;
  iva: number;
  giacenza: number;
  costo_medio?: number;
  prezzo_bd?: number;
  scadenza?: string;
}

// Definisce la struttura dei dati di una variante prodotto ricevuti da Shopify
interface ShopifyVariant {
  id: string; // Es: "gid://shopify/ProductVariant/12345"
  sku: string; // Corrisponde al Minsan
  displayName: string;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number;
  inventoryItem: {
    id: string; // Es: "gid://shopify/InventoryItem/67890"
    unitCost: { amount: string } | null;
  };
  metafield: { value: string } | null; // Per la data di scadenza
  product: { id: string }; // Es: "gid://shopify/Product/54321"
}

// Definisce la struttura della risposta GraphQL di Shopify
interface ShopifyGraphQLResponse {
  data?: { productVariants?: { edges: { node: ShopifyVariant }[] } };
  errors?: { message: string }[];
}

// --- HANDLER PRINCIPALE DELLA FUNZIONE ---
const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  // Recupera le variabili d'ambiente necessarie
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let importId: string;
  try {
    const body = JSON.parse(event.body || "{}");
    importId = body.importId;
    if (!importId) throw new Error("importId non fornito nel corpo della richiesta.");
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo della richiesta non valido o importId mancante." }) };
  }

  try {
    console.log(`[compute-diffs] Avviato per importId: ${importId}`);
    
    // 1. Recupera i prodotti normalizzati e i markup dal database
    const { data: localProducts, error: pError } = await supabase.from('products').select('*').eq('import_id', importId).returns<LocalProduct[]>();
    if (pError) throw pError;
    
    const { data: markups, error: mError } = await supabase.from('company_markups').select('ditta, markup_percentage');
    if (mError) throw mError;

    console.log(`[compute-diffs] Trovati ${localProducts?.length || 0} prodotti normalizzati.`);
    if (!localProducts?.length) {
        return { statusCode: 200, body: JSON.stringify({ message: "Nessun prodotto da analizzare.", updatesFound: 0 }) };
    }

    const markupsMap = new Map(markups?.map(m => [m.ditta, m.markup_percentage]));

    // 2. Costruisce la query GraphQL per interrogare Shopify
    const skusQuery = localProducts.map(p => `sku:'${p.minsan}'`).join(' OR ');
    const graphqlQuery = `
      query getProductVariantsBySku { 
        productVariants(first: 250, query: "${skusQuery}") { 
          edges { 
            node { 
              id 
              sku 
              displayName 
              price 
              compareAtPrice
              inventoryQuantity 
              inventoryItem { id unitCost { amount } }
              metafield(namespace: "custom", key: "data_di_scadenza") { value }
              product { id }
            } 
          } 
        } 
      }`;
    
    // 3. Esegue la chiamata a Shopify
    console.log(`[compute-diffs] Esecuzione chiamata a Shopify per ${localProducts.length} SKU...`);
    const shopifyResponse = await fetch(`https://${SHOPIFY_STORE_NAME}/admin/api/2024-07/graphql.json`, { 
        method: 'POST', 
        headers: { 
            'Content-Type': 'application/json', 
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN 
        }, 
        body: JSON.stringify({ query: graphqlQuery }) 
    });

    if (!shopifyResponse.ok) {
        throw new Error(`Shopify ha risposto con status ${shopifyResponse.status} ${shopifyResponse.statusText}`);
    }
    const shopifyResult = await shopifyResponse.json() as ShopifyGraphQLResponse;
    console.log("[compute-diffs] Risposta da Shopify ricevuta.");
    
    if (shopifyResult.errors) {
        throw new Error(`Errore GraphQL: ${shopifyResult.errors.map((e) => e.message).join(', ')}`);
    }
    
    const shopifyVariants = shopifyResult.data?.productVariants?.edges?.map(edge => edge.node) || [];
    const shopifyVariantsMap = new Map<string, ShopifyVariant>(shopifyVariants.map(v => [v.sku, v]));
    console.log(`[compute-diffs] Shopify ha restituito ${shopifyVariants.length} varianti prodotto corrispondenti.`);
    
    const pendingUpdates = [];

    // 4. Confronta ogni prodotto locale con il corrispondente prodotto di Shopify
    for (const local of localProducts) {
      const shopify = shopifyVariantsMap.get(local.minsan);
      if (!shopify) continue; // Se non c'è su Shopify, lo salta

      const changes: any = {};
      
      // Confronto Giacenza
      if (local.giacenza !== shopify.inventoryQuantity) {
        changes.quantity = { old: shopify.inventoryQuantity, new: local.giacenza };
      }

      // Confronto Costo
      const shopifyCost = shopify.inventoryItem?.unitCost ? parseFloat(shopify.inventoryItem.unitCost.amount) : null;
      const localCost = local.costo_medio;
      if (localCost != null && localCost.toFixed(2) !== shopifyCost?.toFixed(2)) {
        changes.cost = { old: shopifyCost, new: localCost.toFixed(2) };
      }

      // Calcolo e confronto Prezzo (basato su costo e markup)
      const markup = markupsMap.get(local.ditta);
      if (markup !== undefined && markup > 0 && localCost != null) {
        const newPrice = (localCost * (1 + markup / 100) * (1 + (local.iva || 0) / 100)).toFixed(2);
        if (newPrice !== shopify.price) {
          changes.price = { old: shopify.price, new: newPrice };
        }
      }

      // Confronto Prezzo Barrato
      const localComparePrice = local.prezzo_bd?.toFixed(2);
      if (localComparePrice != null && localComparePrice !== shopify.compareAtPrice) {
        changes.compare_at_price = { old: shopify.compareAtPrice, new: localComparePrice };
      }

      // Confronto Data di Scadenza
      const localExpiry = local.scadenza;
      if (localExpiry && localExpiry !== shopify.metafield?.value) {
        changes.expiry_date = { old: shopify.metafield?.value, new: localExpiry };
      }
      
      // Se ci sono modifiche, aggiunge l'oggetto all'array
      if (Object.keys(changes).length > 0) {
        pendingUpdates.push({
          import_id: importId,
          product_id: shopify.product.id,
          product_variant_id: shopify.id,
          inventory_item_id: shopify.inventoryItem?.id,
          product_title: shopify.displayName,
          minsan: local.minsan,
          ditta: local.ditta,
          changes: changes
        });
      }
    }

    // 5. Salva le modifiche trovate nella tabella 'pending_updates' del database
    console.log(`[compute-diffs] Trovate ${pendingUpdates.length} differenze. Salvataggio in corso...`);
    // Prima cancella le vecchie analisi per lo stesso importId per evitare duplicati
    await supabase.from('pending_updates').delete().eq('import_id', importId);
    
    if (pendingUpdates.length > 0) {
      const { error: insertError } = await supabase.from('pending_updates').insert(pendingUpdates);
      if (insertError) {
          console.error("[compute-diffs] Errore durante l'inserimento in pending_updates:", insertError);
          throw insertError;
      }
    }
    console.log("[compute-diffs] Operazioni su DB completate.");

    return { 
        statusCode: 200, 
        body: JSON.stringify({ message: "Calcolo differenze completato.", updatesFound: pendingUpdates.length }) 
    };

  } catch (error: any) {
    console.error("ERRORE CRITICO in compute-diffs:", error);
    const errorMessage = error.message || "Errore sconosciuto. Controllare i log della funzione.";
    return { statusCode: 500, body: JSON.stringify({ error: errorMessage }) };
  }
};

export { handler };
