import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE ---
interface ProductData {
  minsan: string;
  iva: number;
  costo_medio: number;
}
interface ShopifyVariant {
  id: string;
  sku: string;
  price: string;
  product: { id: string };
}
interface ShopifyGraphQLResponse {
  data?: {
    productVariants?: {
      edges: { node: ShopifyVariant }[];
    };
  };
  errors?: { message: string }[];
}

// --- HELPER PER SHOPIFY ---
async function executeShopifyMutation(domain: string, token: string, query: string, variables: object) {
  const url = `https://${domain}/admin/api/2024-07/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json() as any;
  const errs = json.data?.productVariantsBulkUpdate?.userErrors || json.errors || [];
  if (errs.length > 0) {
    const msg = errs.map((e: any) => e.message).join("; ");
    throw new Error(msg);
  }
  return json.data;
}

// --- HANDLER PRINCIPALE ---
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito" }) };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_STORE_NAME || !SHOPIFY_ADMIN_API_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: "Env vars mancanti" }) };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const { ditta } = JSON.parse(event.body || "{}");
    if (!ditta) {
      return { statusCode: 400, body: JSON.stringify({ error: "Nome ditta mancante" }) };
    }

    const { data: markupData, error: mError } = await supabase
      .from("company_markups")
      .select("markup_percentage")
      .eq("ditta", ditta)
      .single();
    if (mError || !markupData) throw new Error("Markup non trovato per la ditta.");
    const markup = markupData.markup_percentage;

    const { data: products, error: pError } = await supabase.rpc('get_latest_products_by_ditta', { ditta_name: ditta });
    if (pError) throw pError;
    if (!products || products.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ message: "Nessun prodotto storico trovato per questa ditta." }) };
    }

    const skusQuery = products.map((p: ProductData) => `sku:'${p.minsan}'`).join(' OR ');
    const graphqlQuery = `query { productVariants(first: 250, query: "${skusQuery}") { edges { node { id sku price product { id } } } } }`;
    const shopifyResponse: ShopifyGraphQLResponse = await (await fetch(`https://${SHOPIFY_STORE_NAME}/admin/api/2024-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query: graphqlQuery }) })).json();
    
    if (shopifyResponse.errors) throw new Error(`Errore GraphQL: ${shopifyResponse.errors.map(e => e.message).join(', ')}`);

    const shopifyVariants = shopifyResponse.data?.productVariants?.edges?.map(edge => edge.node) || [];
    const shopifyVariantsMap = new Map<string, ShopifyVariant>(shopifyVariants.map(v => [v.sku, v]));

    const variantsToUpdate: any[] = [];
    for (const p of products as ProductData[]) {
      const shopifyVariant = shopifyVariantsMap.get(p.minsan);
      if (shopifyVariant && p.costo_medio && markup > 0) {
        const newPrice = (p.costo_medio * (1 + markup / 100) * (1 + (p.iva || 0) / 100)).toFixed(2);
        if (newPrice !== shopifyVariant.price) {
          variantsToUpdate.push({
            id: shopifyVariant.id,
            price: newPrice,
            productId: shopifyVariant.product.id
          });
        }
      }
    }

    if (variantsToUpdate.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ message: "Nessun prezzo da aggiornare per questa ditta." }) };
    }

    const groupedByProduct = variantsToUpdate.reduce((acc, v) => {
        (acc[v.productId] = acc[v.productId] || []).push({id: v.id, price: v.price});
        return acc;
    }, {} as Record<string, {id: string, price: string}[]>);

    for (const [productId, variants] of Object.entries(groupedByProduct)) {
        const bulkMutation = `
          mutation bulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }`;
        await executeShopifyMutation(SHOPIFY_STORE_NAME, SHOPIFY_ADMIN_API_TOKEN, bulkMutation, { productId, variants });
    }

    return { statusCode: 200, body: JSON.stringify({ message: `Aggiornamento globale completato. ${variantsToUpdate.length} prezzi sono stati ricalcolati.` }) };

  } catch (err: any) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Errore interno" }) };
  }
};
