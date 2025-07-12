import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE PER TIPI PIÙ SICURI ---

interface LocalProduct {
  minsan: string;
  giacenza: number;
  costo_medio?: number;
}

interface ShopifyVariant {
  id: string; // Es: "gid://shopify/ProductVariant/12345"
  sku: string;
  displayName: string;
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

async function queryShopify(query: string, shopifyUrl: string, apiToken: string): Promise<ShopifyGraphQLResponse> {
  const response = await fetch(`https://${shopifyUrl}/admin/api/2023-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': apiToken,
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Errore risposta Shopify:", errorText);
    throw new Error(`Errore dalla API di Shopify: ${response.statusText}`);
  }
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
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo richiesta non valido o importId mancante." }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOPIFY_STORE_URL, SHOPIFY_ADMIN_API_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_STORE_URL || !SHOPIFY_ADMIN_API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Variabili d'ambiente mancanti." }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { data: localProducts, error: fetchError } = await supabase
      .from('products')
      .select('minsan, giacenza, costo_medio')
      .eq('import_id', importId)
      .returns<LocalProduct[]>();

    if (fetchError) throw fetchError;
    if (!localProducts || localProducts.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: "Nessun prodotto normalizzato trovato." }) };
    }

    const skusQuery = localProducts.map(p => `sku:${p.minsan}`).join(' OR ');
    const graphqlQuery = `query { productVariants(first: 250, query: "${skusQuery}") { edges { node { id sku displayName inventoryQuantity inventoryItem { unitCost { amount } } } } } }`;

    const shopifyResponse = await queryShopify(graphqlQuery, SHOPIFY_STORE_URL, SHOPIFY_ADMIN_API_TOKEN);

    if (shopifyResponse.errors) {
      throw new Error(`Errore GraphQL da Shopify: ${shopifyResponse.errors.map(e => e.message).join(', ')}`);
    }

    const shopifyVariants = shopifyResponse.data?.productVariants?.edges?.map(edge => edge.node) || [];
    const shopifyVariantsMap = new Map(shopifyVariants.map(v => [v.sku, v]));

    const pendingUpdates = [];
    for (const localProduct of localProducts) {
      const shopifyVariant = shopifyVariantsMap.get(localProduct.minsan);
      if (!shopifyVariant) continue;

      if (localProduct.giacenza !== shopifyVariant.inventoryQuantity) {
        pendingUpdates.push({ import_id: importId, product_variant_id: shopifyVariant.id, product_title: shopifyVariant.displayName, field: 'inventory_quantity', old_value: shopifyVariant.inventoryQuantity, new_value: localProduct.giacenza });
      }

      const shopifyCost = shopifyVariant.inventoryItem?.unitCost ? parseFloat(shopifyVariant.inventoryItem.unitCost.amount) : null;
      if (localProduct.costo_medio != null && localProduct.costo_medio !== shopifyCost) {
        pendingUpdates.push({ import_id: importId, product_variant_id: shopifyVariant.id, product_title: shopifyVariant.displayName, field: 'cost_per_item', old_value: shopifyCost, new_value: localProduct.costo_medio });
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
