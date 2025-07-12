import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE PER TIPI PIÙ SICURI ---

interface LocalProduct {
  minsan: string;
  ditta: string;
  iva: number;
  giacenza: number;
  costo_medio?: number;
}

interface CompanyMarkup {
  ditta: string;
  markup_percentage: number;
}

interface ShopifyVariant {
  id: string;
  sku: string;
  displayName: string;
  price: string;
  inventoryQuantity: number;
  inventoryItem: {
    unitCost: {
      amount: string;
    } | null;
  };
}

interface ShopifyGraphQLResponse {
  data?: {
    productVariants?: {
      edges: { node: ShopifyVariant }[];
    };
  };
  errors?: { message: string }[];
}

// --- FUNZIONI HELPER ---

async function queryShopify(shopifyDomain: string, apiToken: string, query: string): Promise<ShopifyGraphQLResponse> {
  const url = `https://${shopifyDomain}/admin/api/2023-10/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': apiToken },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Errore API Shopify: ${response.statusText}`);
  return response.json() as Promise<ShopifyGraphQLResponse>;
}

// --- HANDLER PRINCIPALE ---

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
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo richiesta non valido." }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const [productsPromise, markupsPromise] = [
      supabase.from('products').select('minsan, ditta, iva, giacenza, costo_medio').eq('import_id', importId).returns<LocalProduct[]>(),
      supabase.from('company_markups').select('ditta, markup_percentage').returns<CompanyMarkup[]>()
    ];
    
    const { data: localProducts, error: productsError } = await productsPromise;
    if (productsError) throw productsError;
    
    const { data: markups, error: markupsError } = await markupsPromise;
    if (markupsError) throw markupsError;

    if (!localProducts || localProducts.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Nessun prodotto normalizzato trovato." }) };
    }

    const markupsMap = new Map(markups?.map(m => [m.ditta, m.markup_percentage]));

    const skusQuery = localProducts.map(p => `sku:'${p.minsan}'`).join(' OR ');
    const graphqlQuery = `query { productVariants(first: 250, query: "${skusQuery}") { edges { node { id sku displayName price inventoryQuantity inventoryItem { unitCost { amount } } } } } }`;
    const shopifyDomain = SHOPIFY_STORE_NAME;
    const shopifyResponse = await queryShopify(shopifyDomain, SHOPIFY_ADMIN_API_TOKEN, graphqlQuery);

    if (shopifyResponse.errors) throw new Error(`Errore GraphQL: ${shopifyResponse.errors.map(e => e.message).join(', ')}`);

    const shopifyVariantsMap = new Map(shopifyResponse.data?.productVariants?.edges?.map(edge => [edge.node.sku, edge.node]) || []);
    
    const pendingUpdates = [];
    for (const localProduct of localProducts) {
      const shopifyVariant = shopifyVariantsMap.get(localProduct.minsan);
      if (!shopifyVariant) continue;

      // A. Confronta la giacenza
      if (localProduct.giacenza !== shopifyVariant.inventoryQuantity) {
        pendingUpdates.push({ import_id: importId, product_variant_id: shopifyVariant.id, product_title: shopifyVariant.displayName, field: 'inventory_quantity', old_value: shopifyVariant.inventoryQuantity, new_value: localProduct.giacenza });
      }

      // B. Confronta il costo (RI-AGGIUNTO)
      const shopifyCost = shopifyVariant.inventoryItem?.unitCost ? parseFloat(shopifyVariant.inventoryItem.unitCost.amount) : null;
      if (localProduct.costo_medio != null && localProduct.costo_medio.toFixed(2) !== shopifyCost?.toFixed(2)) {
          pendingUpdates.push({
              import_id: importId,
              product_variant_id: shopifyVariant.id,
              product_title: shopifyVariant.displayName,
              field: 'cost_per_item',
              old_value: shopifyCost,
              new_value: localProduct.costo_medio.toFixed(2),
          });
      }

      // C. Calcola e confronta il prezzo
      const markup = markupsMap.get(localProduct.ditta);
      if (markup !== undefined && localProduct.costo_medio != null) {
          const costoMedio = localProduct.costo_medio;
          const iva = localProduct.iva || 0;
          const newPrice = costoMedio * (1 + markup / 100) * (1 + iva / 100);
          const newPriceFormatted = newPrice.toFixed(2);
          
          if (newPriceFormatted !== shopifyVariant.price) {
              pendingUpdates.push({
                  import_id: importId,
                  product_variant_id: shopifyVariant.id,
                  product_title: shopifyVariant.displayName,
                  field: 'price',
                  old_value: shopifyVariant.price,
                  new_value: newPriceFormatted,
              });
          }
      }
    }

    if (pendingUpdates.length > 0) {
      await supabase.from('pending_updates').delete().eq('import_id', importId);
      const { error: insertError } = await supabase.from('pending_updates').insert(pendingUpdates);
      if (insertError) throw insertError;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Calcolo delle differenze completato.", updatesFound: pendingUpdates.length }),
    };

  } catch (error: any) {
    console.error("Errore durante il calcolo delle differenze:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || "Errore interno del server." }) };
  }
};

export { handler };
