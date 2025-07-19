import { showModal, hideModal, showUploaderStatus } from './ui.js';

// Variabili globali per i dati originali e filtrati/cercati della tabella
let allComparisonProducts = [];
let filteredComparisonProducts = [];

// Stato di paginazione per la tabella di confronto
let currentPage = 1;
const ITEMS_PER_PAGE = 20;
let totalPages = 1;

// Riferimenti agli elementi UI per i filtri e la paginazione
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
 * Normalizza un codice Minsan rimuovendo caratteri non alfanumerici e convertendo a maiuscolo.
 */
function normalizeMinsan(minsan) {
    if (!minsan) return '';
    return String(minsan).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}

/**
 * Inizializza i riferimenti agli elementi UI e i listener per la tabella di confronto.
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
        console.error("[COMPARE] Alcuni elementi UI della tabella di confronto non sono stati trovati.");
        return false;
    }

    comparisonProductSearch.addEventListener('input', () => {
        currentPage = 1;
        applyFiltersAndSearch();
    });
    comparisonStatusFilter.addEventListener('change', () => {
        currentPage = 1;
        applyFiltersAndSearch();
    });

    comparisonPrevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderFilteredComparisonTable();
            updatePaginationControls();
        }
    });
    comparisonNextPageBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderFilteredComparisonTable();
            updatePaginationControls();
        }
    });

    comparisonTableContainer.removeEventListener('click', handleTableActions);
    comparisonTableContainer.addEventListener('click', handleTableActions);

    const approveSelectedBtn = document.getElementById('approve-selected-btn');
    const approveAllBtn = document.getElementById('approve-all-btn');
    if (approveSelectedBtn && approveAllBtn) {
        approveSelectedBtn.removeEventListener('click', handleApproveSelected);
        approveSelectedBtn.addEventListener('click', handleApproveSelected);
        approveAllBtn.removeEventListener('click', handleApproveAll);
        approveAllBtn.addEventListener('click', handleApproveAll);
    }
    
    return true;
}

/**
 * Renderizza la tabella di confronto tra prodotti File Excel e Shopify.
 */
export function renderComparisonTable(fileProducts, shopifyProducts, metrics) {
    // Debug - Log dei parametri ricevuti
    console.log('[COMPARE] renderComparisonTable called with:', {
        fileProducts: fileProducts,
        fileProductsType: typeof fileProducts,
        fileProductsIsArray: Array.isArray(fileProducts),
        shopifyProducts: shopifyProducts,
        shopifyProductsType: typeof shopifyProducts,
        shopifyProductsIsArray: Array.isArray(shopifyProducts),
        metrics: metrics,
        metricsType: typeof metrics
    });

    // Validazione e normalizzazione dei parametri
    if (!fileProducts || !Array.isArray(fileProducts)) {
        console.warn('[COMPARE] fileProducts non è un array valido, uso array vuoto');
        fileProducts = [];
    }
    if (!shopifyProducts || !Array.isArray(shopifyProducts)) {
        console.warn('[COMPARE] shopifyProducts non è un array valido, uso array vuoto');
        shopifyProducts = [];
    }
    if (!metrics || typeof metrics !== 'object') {
        console.warn('[COMPARE] metrics non è un oggetto valido, uso oggetto vuoto');
        metrics = {};
    }

    // Inizializza UI se necessario
    if (!comparisonTableContainer || !comparisonProductSearch) {
        if (!setupComparisonTableUI()) {
            console.error("[COMPARE] Impossibile inizializzare la tabella di confronto.");
            return;
        }
    }
    
    comparisonTableContainer.classList.remove('hidden');

    // Aggiorna metriche con valori di default
    metricTotalRowsImported.textContent = metrics.totalRowsImported || 0;
    metricNewProducts.textContent = metrics.newProducts || 0;
    metricProductsToModify.textContent = metrics.productsToModify || 0;
    metricShopifyOnly.textContent = metrics.shopifyOnly || 0;
    metricNonImportable.textContent = metrics.nonImportableMinsanZero || 0;

    // Prepara dati unificati
    allComparisonProducts = [];
    const shopifyProductsMap = new Map();

    // Popola la mappa dei prodotti Shopify (con controllo sicurezza)
    if (shopifyProducts && shopifyProducts.length > 0) {
        shopifyProducts.forEach(p => {
            if (p && p.minsan) {
                shopifyProductsMap.set(normalizeMinsan(p.minsan), p);
            }
        });
    }

    // Aggiungi prodotti dal file (con controllo sicurezza)
    if (fileProducts && fileProducts.length > 0) {
        fileProducts.forEach(fileProd => {
            if (!fileProd || !fileProd.Minsan) {
                console.warn('[COMPARE] Prodotto dal file senza Minsan valido:', fileProd);
                return;
            }

            const minsan = normalizeMinsan(fileProd.Minsan);
            const shopifyProd = shopifyProductsMap.get(minsan);
            let status = shopifyProd ? 'sincronizzato' : 'nuovo';
            let hasChanges = false;

            if (shopifyProd) {
                const currG = shopifyProd.variants?.[0]?.inventory_quantity ?? 0;
                const currP = parseFloat(shopifyProd.variants?.[0]?.price ?? 0);
                const currS = shopifyProd.Scadenza || '';
                const currV = shopifyProd.vendor || '';
                const currC = shopifyProd.CostoMedio || 0;
                const currI = shopifyProd.IVA || 0;

                hasChanges = (
                    (fileProd.Giacenza || 0) !== currG ||
                    Math.abs((fileProd.PrezzoBD || 0) - currP) > 0.001 ||
                    (fileProd.Scadenza || '') !== currS ||
                    (fileProd.Ditta || '') !== currV ||
                    Math.abs((fileProd.CostoMedio || 0) - currC) > 0.001 ||
                    Math.abs((fileProd.IVA || 0) - currI) > 0.001
                );
                if (hasChanges) status = 'modificato';
                shopifyProductsMap.delete(minsan);
            }

            // Minsan che inizia per 0
            if (fileProd.isMinsanStartingWithZero) {
                status = 'non-importabile';
                hasChanges = false;
            }

            allComparisonProducts.push({ 
                type: 'product', 
                fileData: fileProd, 
                shopifyData: shopifyProd, 
                status, 
                hasChanges 
            });
        });
    }

    // Aggiungi prodotti solo su Shopify (con controllo sicurezza)
    shopifyProductsMap.forEach(shopifyProd => {
        if (!shopifyProd || !shopifyProd.variants) {
            console.warn('[COMPARE] Prodotto Shopify senza variants:', shopifyProd);
            return;
        }

        const qty = shopifyProd.variants[0]?.inventory_quantity ?? 0;
        if (qty > 0) {
            allComparisonProducts.push({ 
                type: 'product', 
                fileData: null, 
                shopifyData: shopifyProd, 
                status: 'shopify-only', 
                hasChanges: true 
            });
        } else {
            allComparisonProducts.push({ 
                type: 'product', 
                fileData: null, 
                shopifyData: shopifyProd, 
                status: 'sincronizzato (giacenza 0)', 
                hasChanges: false 
            });
        }
    });

    // Riepilogo non-importabile
    const nonImportableCount = metrics.nonImportableMinsanZero || 0;
    if (nonImportableCount > 0) {
        allComparisonProducts.push({ 
            type: 'non-importable-summary', 
            status: 'non-importabile', 
            hasChanges: false, 
            count: nonImportableCount 
        });
    }

    console.log('[COMPARE] allComparisonProducts preparati:', allComparisonProducts.length, 'elementi');

    currentPage = 1;
    applyFiltersAndSearch();
}

/**
 * Applica filtri e ricerca e aggiorna la lista filtrata.
 */
function applyFiltersAndSearch() {
    if (!comparisonProductSearch || !comparisonStatusFilter) {
        console.error('[COMPARE] Elementi di ricerca/filtro non disponibili');
        return;
    }

    const term = comparisonProductSearch.value.toLowerCase();
    const filter = comparisonStatusFilter.value;
    
    let temp = allComparisonProducts.filter(item => {
        if (filter !== 'all' && item.status !== filter && item.type !== 'non-importable-summary') return false;
        if (item.type === 'non-importable-summary') return true;
        
        const minsan = normalizeMinsan(item.fileData?.Minsan || item.shopifyData?.minsan).toLowerCase();
        const desc = (item.fileData?.Descrizione || item.shopifyData?.title || '').toLowerCase();
        const ditta = (item.fileData?.Ditta || item.shopifyData?.vendor || '').toLowerCase();
        const ean = (item.fileData?.EAN || item.shopifyData?.variants?.[0]?.barcode || '').toLowerCase();
        const iva = String(item.fileData?.IVA || item.shopifyData?.IVA || '').toLowerCase();
        
        return minsan.includes(term) || desc.includes(term) || ditta.includes(term) || ean.includes(term) || iva.includes(term);
    });
    
    // Gestione summary
    const summary = allComparisonProducts.find(i => i.type === 'non-importable-summary');
    if (summary) {
        const shouldInclude = (filter === 'all' || filter === 'non-importabile');
        if (shouldInclude && !temp.includes(summary)) temp.push(summary);
        if (!shouldInclude) temp = temp.filter(i => i.type !== 'non-importable-summary');
    }
    temp.sort((a,b) => a.type==='non-importable-summary'?1:b.type==='non-importable-summary'?-1:0);
    
    filteredComparisonProducts = temp;
    totalPages = Math.max(1, Math.ceil(filteredComparisonProducts.length / ITEMS_PER_PAGE));
    updatePaginationControls();
    renderFilteredComparisonTable();
}

/**
 * Aggiorna lo stato dei controlli di paginazione.
 */
function updatePaginationControls() {
    if (!comparisonPageInfo || !comparisonPrevPageBtn || !comparisonNextPageBtn) return;
    
    comparisonPageInfo.textContent = `Pagina ${currentPage} di ${totalPages} (Totale: ${filteredComparisonProducts.length})`;
    comparisonPrevPageBtn.disabled = currentPage <= 1;
    comparisonNextPageBtn.disabled = currentPage >= totalPages;
}

/**
 * Renderizza i prodotti filtrati per la pagina corrente.
 */
function renderFilteredComparisonTable() {
    const placeholder = document.getElementById('table-content-placeholder');
    const approveSel = document.getElementById('approve-selected-btn');
    const approveAll = document.getElementById('approve-all-btn');
    
    if (!placeholder || !approveSel || !approveAll) {
        console.error('[COMPARE] Elementi tabella non trovati');
        return;
    }
    
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const summary = filteredComparisonProducts.find(i => i.type==='non-importable-summary');
    let items = filteredComparisonProducts.slice(start, end);
    
    if (summary && currentPage===totalPages && !items.includes(summary)) {
        items.push(summary);
    }
    
    if (items.length===0) {
        placeholder.innerHTML = '<p>Nessun prodotto corrisponde ai criteri.</p>';
        approveSel.disabled = approveAll.disabled = true;
        return;
    }
    
    let html = `<table class="data-table"><thead>
<tr><th><input type="checkbox" id="selectAllProducts"></th><th>Minsan</th><th>Descrizione</th><th>Ditta</th><th>IVA</th><th>Giacenza (File)</th><th>Giacenza (Shopify)</th><th>Prezzo BD (File)</th><th>Prezzo BD (Shopify)</th><th>Scadenza (File)</th><th>Scadenza (Shopify)</th><th>Stato</th><th>Azioni</th></tr>
</thead><tbody>`;
    
    let pending=0;
    items.forEach(item=>{
        if (item.type==='non-importable-summary') {
            html+=`<tr class="summary"><td></td><td colspan="10" style="text-align:center;font-style:italic;">${item.count} prodotti non importabili</td><td><span class="status-indicator error">Non Importabile</span></td><td></td></tr>`;
            return;
        }
        
        const fp=item.fileData||{}; 
        const sp=item.shopifyData||{};
        const id=normalizeMinsan(fp.Minsan||sp.minsan||'');
        const needs=item.hasChanges;
        if(needs) pending++;
        
        const gFile=fp.Giacenza||'-'; 
        const gShop=sp.variants?.[0]?.inventory_quantity||'-';
        const pFile=fp.PrezzoBD||'-'; 
        const pShop=sp.variants?.[0]?.price?parseFloat(sp.variants[0].price).toFixed(2):'-';
        const sFile=fp.Scadenza||'-'; 
        const sShop=sp.Scadenza||'-';
        
        html+=`<tr data-minsan="${id}" data-status="${item.status}">`+
              `<td><input type="checkbox" class="product-checkbox" ${needs?'':'disabled'}></td>`+
              `<td>${fp.Minsan||sp.minsan||'-'}</td>`+
              `<td>${fp.Descrizione||sp.title||'-'}</td>`+
              `<td>${fp.Ditta||sp.vendor||'-'}</td>`+
              `<td>${fp.IVA||sp.IVA||'-'}</td>`+
              `<td>${gFile}</td><td>${gShop}</td>`+
              `<td>${pFile}</td><td>${pShop}</td>`+
              `<td>${sFile}</td><td>${sShop}</td>`+
              `<td><span class="status-indicator ${item.status}">${item.status.replace(/-/g,' ')}</span></td>`+
              `<td>${needs?`<button class="btn secondary btn-preview" data-minsan="${id}" data-type="${item.status}">Anteprima</button>`+
              `<button class="btn primary btn-approve-single" data-minsan="${id}" data-action="${item.status==='nuovo'?'add':item.status==='shopify-only'?'zero-inventory':'update'}">`+
              `${item.status==='nuovo'?'Aggiungi':item.status==='shopify-only'?'Azzera':'Approva'}</button>`:''}</td>`+
              `</tr>`;
    });
    
    html+=`</tbody></table>`;
    placeholder.innerHTML=html;
    approveSel.disabled=approveAll.disabled=pending===0;
    
    const selAll=document.getElementById('selectAllProducts');
    if(selAll){ 
        selAll.checked=false; 
        selAll.removeEventListener('change',handleSelectAll); 
        selAll.addEventListener('change',handleSelectAll);
    }    
}

/** Seleziona/deseleziona tutti */
function handleSelectAll(e) {
    document.querySelectorAll('.product-checkbox').forEach(cb=>{ 
        if(!cb.disabled) cb.checked=e.target.checked; 
    });
}

/** Gestione click su Anteprima/Approva singolo */
function handleTableActions(e) {
    const target=e.target;
    if(target.classList.contains('btn-preview')){
        const id=normalizeMinsan(target.dataset.minsan);
        const item=allComparisonProducts.find(p=>normalizeMinsan(p.fileData?.Minsan||p.shopifyData?.minsan)===id);
        if(item) showProductPreviewModal(id,item.fileData,item.shopifyData,item.status);
    } else if(target.classList.contains('btn-approve-single')){
        const id=normalizeMinsan(target.dataset.minsan);
        const action=target.dataset.action;
        const statusDiv = document.getElementById('uploader-status');
        if (statusDiv) {
            showUploaderStatus(statusDiv,`Richiesta approvazione per ${id} (Azione: ${action})`, 'info');
        }
    }
}

/** Approva prodotti selezionati */
function handleApproveSelected(){
    const selected=Array.from(document.querySelectorAll('.product-checkbox:checked'))
        .map(cb=>normalizeMinsan(cb.closest('tr').dataset.minsan));
    const statusDiv = document.getElementById('uploader-status');
    if (statusDiv) {
        if(selected.length){ 
            showUploaderStatus(statusDiv,`Approvo selezionati (${selected.length})`, 'info'); 
        } else { 
            showUploaderStatus(statusDiv,'Nessun prodotto selezionato.',true); 
        }
    }
}

/** Approva tutti i prodotti in sospeso */
function handleApproveAll(){
    const allPending=filteredComparisonProducts.filter(i=>i.hasChanges&&i.type==='product')
        .map(i=>normalizeMinsan(i.fileData?.Minsan||i.shopifyData?.minsan));
    const statusDiv = document.getElementById('uploader-status');
    if (statusDiv) {
        if(allPending.length){ 
            showUploaderStatus(statusDiv,`Approvo tutti (${allPending.length})`, 'info'); 
        } else { 
            showUploaderStatus(statusDiv,'Nessun prodotto in attesa.',true); 
        }
    }
}

/** Mostra modal di anteprima con differenze */
export function showProductPreviewModal(minsan,fileProd,shopifyProd,status){
    const titleEl=document.getElementById('preview-modal-title');
    const diffBody=document.getElementById('preview-diff-tbody');
    let btn=document.getElementById('preview-modal-approve-btn');
    
    if(!titleEl||!diffBody||!btn||!document.getElementById('preview-modal-overlay')){
        console.error('[COMPARE] Elementi modal mancanti'); 
        return;
    }
    
    // Clona bottone per rimuovere listener precedenti
    const newBtn=btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn,btn);
    titleEl.textContent=`Anteprima Modifiche per ${minsan}`;
    diffBody.innerHTML='';
    
    if(status==='shopify-only'){
        const currG=shopifyProd?.variants?.[0]?.inventory_quantity||0;
        const currP=parseFloat(shopifyProd?.variants?.[0]?.price||0).toFixed(2);
        const currS=shopifyProd?.Scadenza||'-';
        const currV=shopifyProd?.vendor||'-';
        const currI=shopifyProd?.IVA||'-';
        diffBody.innerHTML=`
            <tr><td>Giacenza</td><td><span class="diff-original">${currG}</span></td><td><span class="diff-new">0</span></td></tr>
            <tr><td colspan="3" style="font-style:italic;">Questo prodotto non è nel file; si propone di azzerare la giacenza.</td></tr>
        `;
        newBtn.textContent='Azzera Giacenza';
        newBtn.dataset.action='zero-inventory';
    } else if (fileProd) {
        // Costruisci righe per nuovi o modificati
        const fields=['Descrizione','Ditta','IVA','Giacenza','PrezzoBD','Scadenza'];
        fields.forEach(field=>{
            const fileVal=fileProd[field]||'-';
            let shopVal='-';
            if (shopifyProd) {
                switch(field) {
                    case 'PrezzoBD':
                        shopVal = parseFloat(shopifyProd.variants?.[0]?.price||0).toFixed(2);
                        break;
                    case 'Giacenza':
                        shopVal = shopifyProd.variants?.[0]?.inventory_quantity||0;
                        break;
                    default:
                        shopVal = shopifyProd[field]||'-';
                }
            }
            const same=fileVal.toString()===shopVal.toString();
            if(same){ 
                diffBody.innerHTML+=`<tr><td>${field}</td><td colspan="2">${fileVal}</td></tr>`; 
            } else { 
                diffBody.innerHTML+=`<tr><td>${field}</td><td><span class="diff-original">${shopVal}</span></td><td><span class="diff-new">${fileVal}</span></td></tr>`; 
            }
        });
        newBtn.textContent=(status==='nuovo'?'Crea Prodotto':'Approva Aggiornamento');
        newBtn.dataset.action=(status==='nuovo'?'add':'update');
    } else {
        diffBody.innerHTML=`<tr><td colspan="3">Dati non disponibili per l'anteprima</td></tr>`;
        newBtn.disabled = true;
    }
    
    newBtn.dataset.minsan=minsan;
    newBtn.addEventListener('click',e=>{
        const action=e.target.dataset.action;
        const statusDiv = document.getElementById('uploader-status');
        if (statusDiv) {
            showUploaderStatus(statusDiv,`Approvazione ${action} per ${minsan}`, 'info');
        }
        hideModal('preview-modal-overlay');
    });
    
    document.getElementById('preview-modal-close-btn')?.addEventListener('click',()=>hideModal('preview-modal-overlay'));
    document.getElementById('preview-modal-cancel-btn')?.addEventListener('click',()=>hideModal('preview-modal-overlay'));
    
    showModal('preview-modal-overlay');
}