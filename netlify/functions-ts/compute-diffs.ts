import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// Interfaccia per i dati che leggiamo dalla nostra tabella 'products'
interface LocalProduct {
  id: number;
  import_id: string;
  minsan: string;
  ean?: string;
  giacenza: number;
  costo_medio?: number;
}

// Interfaccia per i dati che riceviamo da Shopify
interface ShopifyVariant {
  id: string; // Es: "gid://shopify/ProductVariant/12345"
  sku: string;
  inventoryQuantity: number;
  inventoryItem: {
    unitCost: {
      amount: string;
    } | null;
  };
}

// Funzione per interrogare l'API GraphQL di Shopify
async function queryShopify(query: string, shopifyUrl: string, apiToken: string) {
  const response = await fetch(`https://${shopifyUrl}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': apiToken,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    console.error("Errore risposta Shopify:", await response.text());
    throw new Error(`Errore dalla API di Shopify: ${response.statusText}`);
  }
  return response.json();
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
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo richiesta non valido o importId mancante." }) };
  }

  // 1. Carica le credenziali e inizializza i client
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOPIFY_STORE_URL, SHOPIFY_ADMIN_API_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // 2. Recupera i prodotti normalizzati da Supabase
    const { data: localProducts, error: fetchError } = await supabase
      .from('products')
      .select('minsan, giacenza, costo_medio, ean')
      .eq('import_id', importId);

    if (fetchError) throw fetchError;
    if (!localProducts || localProducts.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Nessun prodotto normalizzato trovato." }) };
    }

    // 3. Costruisci la query GraphQL per Shopify
    // Usiamo il Minsan come SKU per la ricerca
    const skusQuery = localProducts.map(p => `sku:${p.minsan}`).join(' OR ');
    const graphqlQuery = `
      query {
        productVariants(first: 250, query: "${skusQuery}") {
          edges {
            node {
              id
              sku
              displayName
              inventoryQuantity
              inventoryItem {
                unitCost {
                  amount
                }
              }
            }
          }
        }
      }
    `;

    // 4. Esegui la query su Shopify
    const shopifyResponse: any = await queryShopify(graphqlQuery, SHOPIFY_STORE_URL, SHOPIFY_ADMIN_API_TOKEN);
    const shopifyVariants = shopifyResponse.data.productVariants.edges.map((edge: any) => edge.node);

    // Mappa i risultati di Shopify per un accesso rapido
    const shopifyVariantsMap = new Map<string, ShopifyVariant>(
      shopifyVariants.map((v: ShopifyVariant) => [v.sku, v])
    );

    // 5. Confronta i dati e genera le differenze
    const pendingUpdates = [];
    for (const localProduct of localProducts) {
      const shopifyVariant = shopifyVariantsMap.get(localProduct.minsan);

      if (!shopifyVariant) {
        console.warn(`Prodotto con Minsan/SKU ${localProduct.minsan} non trovato su Shopify.`);
        continue; // Salta al prossimo prodotto
      }

      // Confronta la giacenza
      if (localProduct.giacenza !== shopifyVariant.inventoryQuantity) {
        pendingUpdates.push({
          import_id: importId,
          product_variant_id: shopifyVariant.id,
          product_title: shopifyVariant.displayName,
          field: 'inventory_quantity',
          old_value: shopifyVariant.inventoryQuantity,
          new_value: localProduct.giacenza,
        });
      }

      // Confronta il costo
      const shopifyCost = shopifyVariant.inventoryItem?.unitCost ? parseFloat(shopifyVariant.inventoryItem.unitCost.amount) : null;
      if (localProduct.costo_medio && localProduct.costo_medio !== shopifyCost) {
        pendingUpdates.push({
          import_id: importId,
          product_variant_id: shopifyVariant.id,
          product_title: shopifyVariant.displayName,
          field: 'cost_per_item',
          old_value: shopifyCost,
          new_value: localProduct.costo_medio,
        });
      }
    }

    // 6. Salva le differenze in 'pending_updates'
    if (pendingUpdates.length > 0) {
      await supabase.from('pending_updates').delete().eq('import_id', importId);
      const { error: insertError } = await supabase.from('pending_updates').insert(pendingUpdates);
      if (insertError) throw insertError;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Calcolo delle differenze completato.",
        updatesFound: pendingUpdates.length,
      }),
    };

  } catch (error: any) {
    console.error("Errore durante il calcolo delle differenze:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno del server." }) };
  }
};

export { handler };
