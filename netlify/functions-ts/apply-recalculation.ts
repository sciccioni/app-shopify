import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- INTERFACCE ---
interface PriceUpdate {
  productId: string;
  variantId: string;
  newPrice: string;
}

// --- HELPER PER SHOPIFY ---
async function executeShopifyMutation(domain: string, token: string, query: string, variables: object) {
  const url = `https://${domain}/admin/api/2024-07/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as any;
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
    const { updates } = JSON.parse(event.body || "{}") as { updates: PriceUpdate[] };
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Nessun aggiornamento da applicare." }) };
    }

    // 1. Raggruppa per productId per bulk update
    const groupedByProduct = updates.reduce((acc, upd) => {
      (acc[upd.productId] = acc[upd.productId] || []).push({ id: upd.variantId, price: upd.newPrice });
      return acc;
    }, {} as Record<string, {id: string, price: string}[]>);

    // 2. Esegui il bulk update per ogni prodotto
    for (const [productId, variants] of Object.entries(groupedByProduct)) {
      const bulkMutation = `
        mutation bulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }
      `;
      await executeShopifyMutation(
        SHOPIFY_STORE_NAME,
        SHOPIFY_ADMIN_API_TOKEN,
        bulkMutation,
        { productId, variants }
      );
    }

    // 3. (Opzionale) Logga l'operazione
    // Potresti aggiungere un log per registrare l'avvenuto ricalcolo globale
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Aggiornamento prezzi completato per ${updates.length} prodotti.` }),
    };

  } catch (err: any) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Errore interno" }),
    };
  }
};

export { handler };
