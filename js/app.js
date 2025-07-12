import { supabase } from './supabaseClient.js';

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const previewInv = document.getElementById('previewInventory');
const previewChanges = document.getElementById('previewChanges');
const approveBtn = document.getElementById('approveBtn');
const progressBar = document.getElementById('progressBar');
const dashboard = document.getElementById('dashboard');
let latestImportTs;
let pendingChanges = [];

// 1) Upload & import
['click','dragover','drop','change'].forEach(evt=>{
  if(evt==='click') dropZone.addEventListener('click', ()=>fileInput.click());
  if(evt==='dragover') dropZone.addEventListener('dragover', e=>e.preventDefault());
  if(evt==='drop') dropZone.addEventListener('drop', e=>{ e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
  if(evt==='change') fileInput.addEventListener('change', e=>handleFile(e.target.files[0]));
});

async function handleFile(file) {
  dropZone.textContent = 'Parsing file...';
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  latestImportTs = new Date().toISOString();

  const rows = raw.map(r => ({
    ditta: r.Ditta,
    minsan: String(r.Minsan || r.EAN),
    scadenza: r.Scadenza ? new Date(r.Scadenza).toISOString().split('T')[0] : null,
    lotto: r.lotto,
    giacenza: r.Giacenza < 0 ? 0 : r.Giacenza,
    costomedio: parseFloat(r.CostoMedio) || 0,
    import_ts: latestImportTs
  }));

  const { error } = await supabase
    .from('raw_inventory')
    .upsert(rows, { onConflict: ['minsan','lotto','import_ts'] });
  if (error) { dropZone.textContent = 'Errore: ' + error.message; return; }

  dropZone.textContent = 'File importato.';
  await showConsolidated();
  await showShopifyChanges();
  approveBtn.disabled = pendingChanges.length === 0;
}

// 2) Preview consolidato
async function showConsolidated() {
  previewInv.innerHTML = '<h2>Inventario Consolidato</h2>';
  const { data } = await supabase.from('consolidated_inventory').select('minsan,next_expiry,total_giacenza');
  const tbl = document.createElement('table');
  tbl.innerHTML = `<thead><tr><th>MINSAN</th><th>Scadenza</th><th>Giacenza</th></tr></thead><tbody>${data.map(r=>`<tr><td>${r.minsan}</td><td>${r.next_expiry}</td><td>${r.total_giacenza}</td></tr>`).join('')}</tbody>`;
  previewInv.appendChild(tbl);
}

// 3) Preview modifiche Shopify
async function showShopifyChanges() {
  previewChanges.innerHTML = '<h2>Modifiche Shopify</h2>';
  const { data: inv } = await supabase.from('consolidated_inventory').select('minsan,total_giacenza,costomedio,ditta');
  pendingChanges = [];
  let rowsHTML = [];
  for (const r of inv) {
    const res = await fetch(`/.netlify/functions/fetch-product?minsan=${r.minsan}`);
    const prod = await res.json();
    if (!prod) continue;
    const oldQty = prod.inventoryQuantity, newQty = r.total_giacenza;
    const oldPrice = prod.price;
    const { data: sup } = await supabase.from('suppliers').select('markup_pct').eq('nome', r.ditta).single();
    const newPrice = (r.costomedio * (1 + (sup?.markup_pct||0)/100)).toFixed(2);
    if (oldQty !== newQty || oldPrice !== newPrice) {
      pendingChanges.push({ minsan: r.minsan, inventoryItemId: prod.inventoryItemId, productId: prod.id, oldQty, newQty, oldPrice, newPrice });
      rowsHTML.push(`<tr><td>${r.minsan}</td><td>${oldQty}→${newQty}</td><td>${oldPrice}→${newPrice}</td></tr>`);
    }
  }
  if (!rowsHTML.length) previewChanges.innerHTML += '<p>Nessuna modifica.</p>';
  else {
    const tbl = document.createElement('table');
    tbl.innerHTML = `<thead><tr><th>MINSAN</th><th>Quantità</th><th>Prezzo</th></tr></thead><tbody>${rowsHTML.join('')}</tbody>`;
    previewChanges.appendChild(tbl);
  }
}

// 4) Approva e sync
approveBtn.addEventListener('click', async () => {
  approveBtn.disabled = true;
  progressBar.textContent = 'Sincronizzazione in corso...';
  const res = await fetch('/.netlify/functions/sync-shopify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes: pendingChanges, importTs: latestImportTs })
  });
  const json = await res.json();
  progressBar.textContent = json.success ? 'Sync completata' : 'Errore: ' + json.error;
  dashboard.innerHTML = `<h2>Risultati</h2><pre>${JSON.stringify(json.results, null, 2)}</pre>`;
});
