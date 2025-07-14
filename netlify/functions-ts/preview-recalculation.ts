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
  displayName: string;
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

    console.log(`[preview-recalc] Avviato per ditta: ${ditta}`);

    const { data: markupData, error: mError } = await supabase
      .from("company_markups")
      .select("markup_percentage")
      .eq("ditta", ditta)
      .single();
    if (mError || !markupData) throw new Error("Markup non trovato per la ditta.");
    const markup = markupData.markup_percentage;
    console.log(`[preview-recalc] Markup trovato: ${markup}%`);

    const { data: products, error: pError } = await supabase.rpc('get_latest_products_by_ditta', { ditta_name: ditta });
    if (pError) throw pError;
    if (!products || products.length === 0) {
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes: [] }) };
    }
    console.log(`[preview-recalc] Trovati ${products.length} prodotti storici per la ditta.`);

    const skusQuery = products.map((p: ProductData) => `sku:'${p.minsan}'`).join(' OR ');
    const graphqlQuery = `query { productVariants(first: 250, query: "${skusQuery}") { edges { node { id sku displayName price product { id } } } } }`;
    const shopifyResponse: ShopifyGraphQLResponse = await (await fetch(`https://${SHOPIFY_STORE_NAME}/admin/api/2024-07/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN }, body: JSON.stringify({ query: graphqlQuery }) })).json();
    
    if (shopifyResponse.errors) throw new Error(`Errore GraphQL: ${shopifyResponse.errors.map(e => e.message).join(', ')}`);

    const shopifyVariants = shopifyResponse.data?.productVariants?.edges?.map(edge => edge.node) || [];
    const shopifyVariantsMap = new Map<string, ShopifyVariant>(shopifyVariants.map(v => [v.sku, v]));
    console.log(`[preview-recalc] Shopify ha restituito ${shopifyVariants.length} varianti corrispondenti.`);

    const priceChanges: any[] = [];
    for (const p of products as ProductData[]) {
      const shopifyVariant = shopifyVariantsMap.get(p.minsan);
      if (shopifyVariant && p.costo_medio && markup > 0) {
        const newPrice = (p.costo_medio * (1 + markup / 100) * (1 + (p.iva || 0) / 100)).toFixed(2);
        
        const currentPrice = parseFloat(shopifyVariant.price).toFixed(2);

        console.log(`[preview-recalc] Minsan: ${p.minsan} | Prezzo Shopify: ${currentPrice} | Nuovo Prezzo Calcolato: ${newPrice}`);

        if (newPrice !== currentPrice) {
          priceChanges.push({
            product_id: shopifyVariant.product.id,
            variant_id: shopifyVariant.id,
            product_title: shopifyVariant.displayName,
            minsan: p.minsan,
            old_price: currentPrice,
            new_price: newPrice,
          });
        }
      }
    }
    
    console.log(`[preview-recalc] Trovate ${priceChanges.length} modifiche di prezzo da proporre.`);
    return { 
        statusCode: 200, 
        headers: { "Content-Type": "application/json" }, // <-- CORREZIONE FONDAMENTALE
        body: JSON.stringify({ changes: priceChanges }) 
    };

  } catch (err: any) {
    console.error("[preview-recalc] Errore:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Errore interno" }) };
  }
};

export { handler };
