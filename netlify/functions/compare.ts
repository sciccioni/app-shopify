import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL        = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SHOPIFY_STORE       = process.env.SHOPIFY_STORE_NAME!;
const SHOPIFY_TOKEN       = process.env.SHOPIFY_ADMIN_API_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { import_id } = JSON.parse(event.body || '{}');
  if (!import_id) {
    return { statusCode: 400, body: 'import_id mancante' };
  }

  // ── 0. VALIDAZIONE VAT_RATE ─────────────────────────────────────────────
  const { data: badProducts, error: fetchVatErr } = await supabase
    .from('products')
    .select('minsan')
    .is('vat_rate', null);

  if (fetchVatErr) {
    return {
      statusCode: 500,
      body: `Errore in fase di verifica VAT: ${fetchVatErr.message}`
    };
  }

  if (badProducts && badProducts.length > 0) {
    const missingList = badProducts.map(p => p.minsan).join(', ');
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `I seguenti prodotti non hanno VAT configurato: ${missingList}`
      })
    };
  }

  // ── 1. CARICAMENTO DATI NORMALIZZATI ────────────────────────────────────
  const { data: normalized, error: normErr } = await supabase
    .from('normalized_inventory')
    .select('id as staging_id, minsan, total_qty')
    .eq('import_id', import_id);

  if (normErr) {
    return {
      statusCode: 500,
      body: `Errore fetch normalized_inventory: ${normErr.message}`
    };
  }

  // ── 2. CARICAMENTO CONFIGURAZIONE MARKUP ────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('name, markup_pct');

  if (compErr) {
    return {
      statusCode: 500,
      body: `Errore fetch companies: ${compErr.message}`
    };
  }

  const companyMap = new Map(companies!.map(c => [c.name, Number(c.markup_pct)]));

  // ── 3. CALCOLO DELLE DIFFERENZE ─────────────────────────────────────────
  const updates: Array<{
    import_id: string;
    staging_id: string;
    product_id: string;
    old_qty: number;
    new_qty: number;
    old_price: number;
    new_price: number;
    significant: boolean;
  }> = [];

  for (const rec of normalized!) {
    // Recupera il prodotto corrispondente
    const { data: prod, error: prodErr } = await supabase
      .from('products')
      .select('id, current_qty, current_price, vat_rate, shopify_sku')
      .eq('minsan', rec.minsan)
      .single();

    if (prodErr || !prod) {
      // Se manca del prodotto, salta
      continue;
    }

    // Estrai il nome ditta dallo SKU (es. "DITTA-1234")
    const companyKey = prod.shopify_sku.split('-')[0];
    const markupPct = companyMap.get(companyKey) ?? 0;

    // Calcolo nuovo prezzo: prezzo × (1+markup) × (1+vat_rate)
    const newPrice = parseFloat(
      (
        prod.current_price *
        (1 + markupPct / 100) *
        (1 + prod.vat_rate / 100)
      ).toFixed(2)
    );

    // Differenze quantità e prezzo
    const diffQty   = rec.total_qty - prod.current_qty;
    const diffPrice = newPrice - prod.current_price;
    const significant =
      Math.abs(diffQty) > 0 || Math.abs(diffPrice) >= 0.01;

    if (significant) {
      updates.push({
        import_id,
        staging_id: rec.staging_id,
        product_id: prod.id,
        old_qty: prod.current_qty,
        new_qty: rec.total_qty,
        old_price: prod.current_price,
        new_price: newPrice,
        significant
      });
    }
  }

  // ── 4. INSERIMENTO IN pending_updates ──────────────────────────────────
  const { error: insertErr } = await supabase
    .from('pending_updates')
    .insert(updates);

  if (insertErr) {
    return {
      statusCode: 500,
      body: `Errore inserimento pending_updates: ${insertErr.message}`
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      import_id,
      updates_count: updates.length
    })
  };
};
