import { showModal, hideModal, showUploaderStatus } from './ui.js';

// Dati globali
let allComparisonProducts = [];
let filteredComparisonProducts = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 20;
let totalPages = 1;

// Riferimenti UI
let comparisonProductSearch;
let comparisonStatusFilter;
let comparisonPrevPageBtn;
let comparisonNextPageBtn;
let comparisonPageInfo;
let metricTotalRowsImported;
let metricNewProducts;
let metricProductsToModify;
let metricShopifyOnly;
let metricNonImportable;
let comparisonTableContainer;

/**
 * Normalizza un codice Minsan.
 */
function normalizeMinsan(minsan) {
  return minsan ? String(minsan).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim() : '';
}

/**
 * Inizializza elementi e listener.
 */
function setupComparisonTableUI() {
  comparisonProductSearch = document.getElementById('comparisonProductSearch');
  comparisonStatusFilter = document.getElementById('comparisonStatusFilter');
  comparisonPrevPageBtn = document.getElementById('comparisonPrevPageBtn');
  comparisonNextPageBtn = document.getElementById('comparisonNextPageBtn');
  comparisonPageInfo = document.getElementById('comparisonPageInfo');
  metricTotalRowsImported = document.getElementById('metricTotalRowsImported');
  metricNewProducts = document.getElementById('metricNewProducts');
  metricProductsToModify = document.getElementById('metricProductsToModify');
  metricShopifyOnly = document.getElementById('metricShopifyOnly');
  metricNonImportable = document.getElementById('metricNonImportable');
  comparisonTableContainer = document.getElementById('comparison-table-container');

  if (!comparisonProductSearch || !comparisonStatusFilter || !comparisonPrevPageBtn || !comparisonNextPageBtn ||
      !comparisonPageInfo || !metricTotalRowsImported || !metricNewProducts || !metricProductsToModify ||
      !metricShopifyOnly || !metricNonImportable || !comparisonTableContainer) {
    console.error('[COMPARE] Elementi UI mancanti.');
    return false;
  }

  comparisonProductSearch.addEventListener('input', () => { currentPage = 1; applyFiltersAndSearch(); });
  comparisonStatusFilter.addEventListener('change', () => { currentPage = 1; applyFiltersAndSearch(); });

  comparisonPrevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderFilteredComparisonTable(); updatePaginationControls(); }
  });
  comparisonNextPageBtn.addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; renderFilteredComparisonTable(); updatePaginationControls(); }
  });

  // Delegazione
  comparisonTableContainer.removeEventListener('click', handleTableActions);
  comparisonTableContainer.addEventListener('click', handleTableActions);

  // Pulsanti bulk
  ['approve-selected-btn', 'approve-all-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.removeEventListener('click', id === 'approve-selected-btn' ? handleApproveSelected : handleApproveAll);
      btn.addEventListener('click', id === 'approve-selected-btn' ? handleApproveSelected : handleApproveAll);
    }
  });

  return true;
}

/**
 * Funzione principale di rendering.
 */
export function renderComparisonTable(fileProducts, shopifyProducts, metrics) {
  if (!comparisonTableContainer) {
    if (!setupComparisonTableUI()) return;
  }
  comparisonTableContainer.classList.remove('hidden');

  // Aggiorna metriche
  if (metrics) {
    metricTotalRowsImported.textContent = metrics.totalRowsImported;
    metricNewProducts.textContent = metrics.newProducts;
    metricProductsToModify.textContent = metrics.productsToModify;
    metricShopifyOnly.textContent = metrics.shopifyOnly;
    metricNonImportable.textContent = metrics.nonImportableMinsanZero;
  }

  // Prepara dati unificati
  allComparisonProducts = [];
  const shopifyMap = new Map(
    (Array.isArray(shopifyProducts) ? shopifyProducts : []).map(p => [normalizeMinsan(p.minsan), p])
  );

  fileProducts.forEach(fp => {
    const minsan = normalizeMinsan(fp.Minsan);
    const sp = shopifyMap.get(minsan);
    let status = sp ? 'sincronizzato' : 'nuovo';
    let hasChanges = false;

    if (sp) {
      // Confronti giacenza, prezzo, scadenza, ditta, costo, iva
      const diffG = fp.Giacenza !== (sp.variants[0]?.inventory_quantity || 0);
      const diffP = Math.abs(fp.PrezzoBD - parseFloat(sp.variants[0]?.price || 0)) > 0.001;
      const diffS = (fp.Scadenza || '') !== (sp.Scadenza || '');
      const diffD = (fp.Ditta || '') !== (sp.vendor || '');
      const diffC = Math.abs(fp.CostoMedio - (sp.CostoMedio || 0)) > 0.001;
      const diffI = Math.abs(fp.IVA - (sp.IVA || 0)) > 0.001;
      hasChanges = diffG || diffP || diffS || diffD || diffC || diffI;
      if (hasChanges) status = 'modificato';
      shopifyMap.delete(minsan);
    }

    if (fp.isMinsanStartingWithZero) {
      status = 'non-importabile';
      hasChanges = false;
    }

    allComparisonProducts.push({ type: 'product', fileData: fp, shopifyData: sp || null, status, hasChanges });
  });

  // Solo Shopify
  shopifyMap.forEach(sp => {
    const qty = sp.variants[0]?.inventory_quantity || 0;
    if (qty > 0) {
      allComparisonProducts.push({ type: 'product', fileData: null, shopifyData: sp, status: 'shopify-only', hasChanges: true });
    } else {
      allComparisonProducts.push({ type: 'product', fileData: null, shopifyData: sp, status: 'sincronizzato', hasChanges: false });
    }
  });

  // Summary non-importabile
  if (metrics.nonImportableMinsanZero > 0) {
    allComparisonProducts.push({ type: 'non-importable-summary', status: 'non-importabile', hasChanges: false, count: metrics.nonImportableMinsanZero });
  }

  currentPage = 1;
  applyFiltersAndSearch();
}

/** Filtra e cerca */
function applyFiltersAndSearch() {
  const term = comparisonProductSearch.value.toLowerCase();
  const filter = comparisonStatusFilter.value;
  let temp = allComparisonProducts.filter(item => {
    if (filter !== 'all' && item.status !== filter && item.type !== 'non-importable-summary') return false;
    if (item.type === 'product') {
      const minsan = normalizeMinsan(item.fileData?.Minsan || item.shopifyData.minsan);
      const desc = (item.fileData?.Descrizione || item.shopifyData.title || '').toLowerCase();
      const ditta = (item.fileData?.Ditta || item.shopifyData.vendor || '').toLowerCase();
      const ean = (item.fileData?.EAN || item.shopifyData.variants[0]?.barcode || '').toLowerCase();
      const iva = String(item.fileData?.IVA || item.shopifyData.IVA || '').toLowerCase();
      return minsan.includes(term) || desc.includes(term) || ditta.includes(term) || ean.includes(term) || iva.includes(term);
    }
    return true;
  });

  // Gestione summary
  const summary = allComparisonProducts.find(i => i.type === 'non-importable-summary');
  if (summary) {
    if ((filter === 'all' || filter === 'non-importabile') && !temp.includes(summary)) temp.push(summary);
    if (filter !== 'all' && filter !== 'non-importabile') temp = temp.filter(i => i.type !== 'non-importable-summary');
  }

  // Ordina summary in fondo
  temp.sort((a, b) => a.type === 'non-importable-summary' ? 1 : b.type === 'non-importable-summary' ? -1 : 0);

  filteredComparisonProducts = temp;
  totalPages = Math.max(1, Math.ceil(filteredComparisonProducts.length / ITEMS_PER_PAGE));
  updatePaginationControls();
  renderFilteredComparisonTable();
}

/** Aggiorna controlli paginazione */
function updatePaginationControls() {
  comparisonPageInfo.textContent = `Pagina ${currentPage} di ${totalPages} (Totale: ${filteredComparisonProducts.length})`;
  comparisonPrevPageBtn.disabled = currentPage <= 1;
  comparisonNextPageBtn.disabled = currentPage >= totalPages;
}

/** Render della tabella paginata */
function renderFilteredComparisonTable() {
  const placeholder = document.getElementById('table-content-placeholder');
  const approveSel = document.getElementById('approve-selected-btn');
  const approveAll = document.getElementById('approve-all-btn');
  if (!placeholder || !approveSel || !approveAll) return;

  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const summary = filteredComparisonProducts.find(i => i.type === 'non-importable-summary');
  let pageItems = filteredComparisonProducts.slice(start, end);
  if (summary && currentPage === totalPages && !pageItems.includes(summary)) {
    pageItems.push(summary);
  }

  if (pageItems.length === 0) {
    placeholder.innerHTML = '<p>Nessun prodotto...</p>';
    approveSel.disabled = approveAll.disabled = true;
    return;
  }

  let html = `<table class="data-table"><thead>...INTES HEAD HTML...</thead><tbody>`;
  let pendingCount = 0;
  pageItems.forEach(item => {
    if (item.type === 'non-importable-summary') {
      html += `<tr class="summary"><td colspan="13">${item.count} prodotti non importabili</td></tr>`;
      return;
    }
    const file = item.fileData || {};
    const shop = item.shopifyData || {};
    const id = normalizeMinsan(file.Minsan || shop.minsan || '');
    const needs = item.hasChanges;
    if (needs) pendingCount++;
    html += `<tr data-minsan="${id}" data-status="${item.status}">` +
            `<td><input type="checkbox" class="product-checkbox" ${needs ? '' : 'disabled'}></td>` +
            `<td>${file.Minsan||shop.minsan||'-'}</td>` +
            `<td>${file.Descrizione||shop.title||'-'}</td>` +
            `<td>${file.Ditta||shop.vendor||'-'}</td>` +
            `<td>${file.IVA||shop.IVA||'-'}</td>` +
            `<td>${file.Giacenza||'-'}</td>` +
            `<td>${shop.variants?.[0]?.inventory_quantity||'-'}</td>` +
            `<td>${file.PrezzoBD||'-'}</td>` +
            `<td>${parseFloat(shop.variants?.[0]?.price||0).toFixed(2)||'-'}</td>` +
            `<td>${file.Scadenza||'-'}</td>` +
            `<td>${shop.Scadenza||'-'}</td>` +
            `<td>${item.status}</td>` +
            `<td>${needs?`<button class="btn-preview" data-minsan="${id}">Anteprima</button><button class="btn-approve-single" data-minsan="${id}">` +
            `${item.status==='nuovo'?'Aggiungi':item.status==='shopify-only'?'Azzera':'Approva'}</button>`:''}</td>` +
            `</tr>`;
  });
  html += '</tbody></table>';
  placeholder.innerHTML = html;
  approveSel.disabled = approveAll.disabled = pendingCount === 0;

  const selectAll = document.getElementById('selectAllProducts');
  if (selectAll) {
    selectAll.checked = false;
    selectAll.removeEventListener('change', handleSelectAll);
    selectAll.addEventListener('change', handleSelectAll);
  }
}

/** Seleziona tutto */
function handleSelectAll(e) {
  document.querySelectorAll('.product-checkbox').forEach(cb => { if (!cb.disabled) cb.checked = e.target.checked; });
}

/** Delegazione azioni */
function handleTableActions(e) {
  const target = e.target;
  if (target.classList.contains('btn-preview')) {
    const id = normalizeMinsan(target.dataset.minsan);
    const item = allComparisonProducts.find(p => normalizeMinsan(p.fileData?.Minsan||p.shopifyData?.minsan)===id);
    if (item) showProductPreviewModal(id, item.fileData, item.shopifyData, item.status);
  } else if (target.classList.contains('btn-approve-single')) {
    const id = normalizeMinsan(target.dataset.minsan);
    showUploaderStatus(document.getElementById('uploader-status'), `Approvo ${id}`, 'info');
  }
}

/** Bulk approve selezionati */
function handleApproveSelected() {
  const selected = Array.from(document.querySelectorAll('.product-checkbox:checked')).map(cb=>normalizeMinsan(cb.closest('tr').dataset.minsan));
  if (selected.length) showUploaderStatus(document.getElementById('uploader-status'), `Approvo selezionati: ${selected.join(', ')}`, 'info');
  else showUploaderStatus(document.getElementById('uploader-status'), 'Nessun prodotto selezionato', true);
}

/** Bulk approve tutti */
function handleApproveAll() {
  const allPending = filteredComparisonProducts.filter(i=>i.hasChanges&&i.type==='product').map(i=>normalizeMinsan(i.fileData?.Minsan||i.shopifyData.minsan));
  showUploaderStatus(document.getElementById('uploader-status'), allPending.length?`Approvo tutti: ${allPending.join(', ')}`:'Nessun prodotto in sospeso', 'info');
}

/** Modal di anteprima */
export function showProductPreviewModal(minsan, fileProd, shopifyProd, status) {
  const title = document.getElementById('preview-modal-title');
  const tbody = document.getElementById('preview-diff-tbody');
  let btn = document.getElementById('preview-modal-approve-btn');
  if (!title||!tbody||!btn) return console.error('Elementi modal mancanti');

  title.textContent = `Anteprima ${minsan}`;
  tbody.innerHTML = '';

  // Costruisci righe diff...
  // [Implementazione simile a prima con differenze evidenziate]

  btn.textContent = status==='shopify-only'?'Azzera':'Approva';
  btn.onclick = () => { showUploaderStatus(document.getElementById('uploader-status'), `Azione ${btn.textContent} per ${minsan}`, 'info'); hideModal('preview-modal-overlay'); };

  document.getElementById('preview-modal-close-btn')?.addEventListener('click', ()=>hideModal('preview-modal-overlay'));
  showModal('preview-modal-overlay');
}
