// assets/js/comparison.js - COMPLETO E CORRETTO (Metrice, Filtri, Ricerca, Colonne IVA/Ditta)

import { showModal, hideModal, showUploaderStatus } from './ui.js';

// Variabili globali per i dati originali e filtrati/cercati della tabella
let allComparisonProducts = []; // Tutti i prodotti da visualizzare (file + shopify, anche non importabili)
let filteredComparisonProducts = []; // Prodotti attualmente visualizzati dopo filtri/ricerca

/**
 * Renderizza la tabella di confronto tra prodotti Excel e Shopify.
 * @param {Array<object>} fileProducts - Prodotti elaborati dal file Excel (Minsan validi e non inizianti per 0).
 * @param {Array<object>} shopifyProducts - Prodotti recuperati da Shopify.
 * @param {object} metrics - Oggetto con le metriche di riepilogo (da process-excel.js).
 */
export function renderComparisonTable(fileProducts, shopifyProducts, metrics) {
    const comparisonTableContainer = document.getElementById('comparison-table-container');
    const tableContentPlaceholder = document.getElementById('table-content-placeholder');
    const approveSelectedBtn = document.getElementById('approve-selected-btn');
    const approveAllBtn = document.getElementById('approve-all-btn');

    // Elementi Metriche
    const metricTotalRowsImported = document.getElementById('metricTotalRowsImported');
    const metricNewProducts = document.getElementById('metricNewProducts');
    const metricProductsToModify = document.getElementById('metricProductsToModify');
    const metricShopifyOnly = document.getElementById('metricShopifyOnly');
    const metricNonImportable = document.getElementById('metricNonImportable');

    // Elementi Filtri
    const comparisonProductSearch = document.getElementById('comparisonProductSearch');
    const comparisonStatusFilter = document.getElementById('comparisonStatusFilter');

    if (!comparisonTableContainer || !tableContentPlaceholder || !approveSelectedBtn || !approveAllBtn ||
        !metricTotalRowsImported || !metricNewProducts || !metricProductsToModify ||
        !metricShopifyOnly || !metricNonImportable || !comparisonProductSearch || !comparisonStatusFilter) {
        console.error("Contenitori della tabella di confronto, bottoni, metriche o filtri non trovati. Assicurarsi che 'comparison-table.html' sia caricato correttamente.");
        return;
    }

    comparisonTableContainer.classList.remove('hidden');
    tableContentPlaceholder.innerHTML = ''; // Pulisce il contenuto precedente

    // --- Aggiorna Metriche ---
    if (metrics) {
        metricTotalRowsImported.textContent = metrics.totalRowsImported;
        metricNewProducts.textContent = metrics.newProducts;
        metricProductsToModify.textContent = metrics.productsToModify;
        metricShopifyOnly.textContent = metrics.shopifyOnly;
        metricNonImportable.textContent = metrics.nonImportableMinsanZero;
    }

    if (fileProducts.length === 0 && shopifyProducts.length === 0 && metrics.nonImportableMinsanZero === 0) {
        tableContentPlaceholder.innerHTML = '<p>Nessun dato da confrontare.</p>';
        approveSelectedBtn.disabled = true;
        approveAllBtn.disabled = true;
        return;
    }

    // --- Prepara allComparisonProducts (include anche i non importabili per le metriche) ---
    allComparisonProducts = [];
    const shopifyProductsMap = new Map(shopifyProducts.map(p => [String(p.minsan).trim(), p]));

    // Aggiungi prodotti dal file (con status)
    fileProducts.forEach(fileProd => {
        const minsan = String(fileProd.Minsan).trim();
        const shopifyProd = shopifyProductsMap.get(minsan);
        let status = 'sincronizzato';
        let hasChanges = false;

        if (shopifyProd) {
            const currentGiacenza = shopifyProd.variants[0]?.inventory_quantity ?? 0;
            const currentPrice = parseFloat(shopifyProd.variants[0]?.price ?? 0);
            const currentScadenza = shopifyProd.Scadenza || '';
            const currentVendor = shopifyProd.vendor || '';
            const currentCostoMedio = shopifyProd.CostoMedio || 0;
            const currentIVA = shopifyProd.IVA || 0;

            hasChanges = (fileProd.Giacenza !== currentGiacenza ||
                          Math.abs(fileProd.PrezzoBD - currentPrice) > 0.001 ||
                          (fileProd.Scadenza || '') !== currentScadenza ||
                          (fileProd.Ditta || '') !== currentVendor ||
                          Math.abs(fileProd.CostoMedio - currentCostoMedio) > 0.001 ||
                          Math.abs(fileProd.IVA - currentIVA) > 0.001);

            if (hasChanges) {
                status = 'modificato';
            }
            // Rimuovi dalla mappa Shopify per identificare i "Solo Shopify" dopo
            shopifyProductsMap.delete(minsan);
        } else {
            status = 'nuovo';
        }
        allComparisonProducts.push({
            type: 'file_product', // Indica che deriva dal file
            fileData: fileProd,
            shopifyData: shopifyProd,
            status: status,
            hasChanges: hasChanges
        });
    });

    // Aggiungi prodotti solo su Shopify
    shopifyProductsMap.forEach(shopifyProd => {
        if ((shopifyProd.variants[0]?.inventory_quantity ?? 0) > 0) { // Solo se giacenza > 0
            allComparisonProducts.push({
                type: 'shopify_only', // Indica che è solo su Shopify
                fileData: null,
                shopifyData: shopifyProd,
                status: 'shopify-only',
                hasChanges: true // Sarà sempre "da azzerare"
            });
        } else {
            // Se giacenza 0, consideralo sincronizzato (non richiede azione)
             allComparisonProducts.push({
                type: 'shopify_only_zero',
                fileData: null,
                shopifyData: shopifyProd,
                status: 'sincronizzato (giacenza 0)',
                hasChanges: false
            });
        }
    });

    // Aggiungi placeholder per i Minsan non importabili (per le metriche)
    // Non abbiamo i dati completi qui, solo il conteggio, ma possiamo aggiungerne una riga riassuntiva
    if (metrics.nonImportableMinsanZero > 0) {
        allComparisonProducts.push({
            type: 'non-importable-summary',
            status: 'non-importable',
            hasChanges: false, // Non è una modifica da applicare
            count: metrics.nonImportableMinsanZero // Numero di elementi non importabili
        });
    }

    // --- Setup Listener per Ricerca e Filtro ---
    // Rimuovi vecchi listener per evitare duplicati
    comparisonProductSearch.removeEventListener('input', applyFiltersAndSearch);
    comparisonStatusFilter.removeEventListener('change', applyFiltersAndSearch);

    // Aggiungi nuovi listener
    comparisonProductSearch.addEventListener('input', applyFiltersAndSearch);
    comparisonStatusFilter.addEventListener('change', applyFiltersAndSearch);

    // Esegui la prima applicazione di filtri e ricerca
    applyFiltersAndSearch();

    // Abilita/Disabilita i bottoni di approvazione (basato su filteredProducts dopo il filtro iniziale)
    // Questo verrà gestito da applyFiltersAndSearch
}

/**
 * Applica i filtri e la ricerca ai prodotti e renderizza la tabella.
 */
function applyFiltersAndSearch() {
    const searchTerm = document.getElementById('comparisonProductSearch').value.toLowerCase();
    const statusFilter = document.getElementById('comparisonStatusFilter').value;
    const companiesTableBody = document.getElementById('companiesTableBody'); // Riferimento corretto al tbody per le ditte
    
    // Filtra per stato
    let tempFilteredProducts = allComparisonProducts.filter(item => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'non-importable' && item.type === 'non-importable-summary') return true;
        return item.status === statusFilter;
    });

    // Filtra per ricerca
    tempFilteredProducts = tempFilteredProducts.filter(item => {
        if (item.type === 'non-importable-summary') return true; // Mostra sempre il riassunto se il filtro lo permette
        const minsan = String(item.fileData?.Minsan || item.shopifyData?.minsan || '').toLowerCase();
        const description = String(item.fileData?.Descrizione || item.shopifyData?.title || '').toLowerCase();
        const ditta = String(item.fileData?.Ditta || item.shopifyData?.vendor || '').toLowerCase();
        const ean = String(item.fileData?.EAN || item.shopifyData?.variants?.[0]?.barcode || '').toLowerCase();

        return minsan.includes(searchTerm) ||
               description.includes(searchTerm) ||
               ditta.includes(searchTerm) ||
               ean.includes(searchTerm);
    });

    filteredComparisonProducts = tempFilteredProducts; // Aggiorna i prodotti filtrati globalmente

    // Renderizza la tabella con i prodotti filtrati/cercati
    renderFilteredComparisonTable();
}


/**
 * Renderizza solo i prodotti attualmente filtrati e cercati.
 */
function renderFilteredComparisonTable() {
    const tableContentPlaceholder = document.getElementById('table-content-placeholder');
    const approveSelectedBtn = document.getElementById('approve-selected-btn');
    const approveAllBtn = document.getElementById('approve-all-btn');

    if (!tableContentPlaceholder || !approveSelectedBtn || !approveAllBtn) return; // Doppia verifica

    if (filteredComparisonProducts.length === 0) {
        tableContentPlaceholder.innerHTML = '<p>Nessun prodotto corrisponde ai criteri di ricerca/filtro.</p>';
        approveSelectedBtn.disabled = true;
        approveAllBtn.disabled = true;
        return;
    }

    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th><input type="checkbox" id="selectAllProducts"></th>
                    <th>Minsan</th>
                    <th>Descrizione</th>
                    <th>Ditta</th> <th>IVA</th> <th>Giacenza (File)</th>
                    <th>Giacenza (Shopify)</th>
                    <th>Prezzo BD (File)</th>
                    <th>Prezzo BD (Shopify)</th>
                    <th>Scadenza (File)</th>
                    <th>Scadenza (Shopify)</th>
                    <th>Stato</th>
                    <th>Azioni</th>
                </tr>
            </thead>
            <tbody>
    `;

    let productsRequiringApprovalInView = 0;

    filteredComparisonProducts.forEach(item => {
        if (item.type === 'non-importable-summary') {
            html += `
                <tr class="row-non-importable">
                    <td></td>
                    <td colspan="10" style="text-align: center;">${item.count} prodotti non importabili (Minsan inizia per 0)</td>
                    <td><span class="status-indicator error">Non Importabile</span></td>
                    <td></td>
                </tr>
            `;
            return; // Salta al prossimo item
        }

        const fileProd = item.fileData;
        const shopifyProd = item.shopifyData;
        const status = item.status;
        const needsApproval = item.hasChanges; // Flag per abilitare/disabilitare checkbox e bottoni

        if (needsApproval) productsRequiringApprovalInView++;

        let giacenzaFile = '-';
        let giacenzaShopify = '-';
        let prezzoBdFile = '-';
        let prezzoBdShopify = '-';
        let scadenzaFile = '-';
        let scadenzaShopify = '-';
        let dittaFile = '-';
        let ivaFile = '-';
        let dittaShopify = '-'; // Per confronto
        let ivaShopify = '-'; // Per confronto


        if (fileProd) {
            giacenzaFile = fileProd.Giacenza;
            prezzoBdFile = fileProd.PrezzoBD;
            scadenzaFile = fileProd.Scadenza || '-';
            dittaFile = fileProd.Ditta || '-'; // Ditta dal file
            ivaFile = fileProd.IVA || '-';     // IVA dal file
        }

        if (shopifyProd) {
            giacenzaShopify = shopifyProd.variants[0]?.inventory_quantity ?? 0;
            prezzoBdShopify = parseFloat(shopifyProd.variants[0]?.price ?? 0).toFixed(2);
            scadenzaShopify = shopifyProd.Scadenza || '-';
            dittaShopify = shopifyProd.vendor || '-'; // Ditta da Shopify
            ivaShopify = shopifyProd.IVA || '-';     // IVA da Shopify (se recuperata)
        }

        const giacenzaDiffDisplay = (fileProd && shopifyProd && fileProd.Giacenza !== giacenzaShopify) ?
                                    `<span class="${fileProd.Giacenza > giacenzaShopify ? 'text-success' : 'text-danger'}">(${fileProd.Giacenza - giacenzaShopify > 0 ? '+' : ''}${fileProd.Giacenza - giacenzaShopify})</span>` : '';
        
        const prezzoBdDiffDisplay = (fileProd && shopifyProd && Math.abs(fileProd.PrezzoBD - parseFloat(prezzoBdShopify)) > 0.001) ?
                                    `<span class="${fileProd.PrezzoBD > parseFloat(prezzoBdShopify) ? 'text-success' : 'text-danger'}">(${fileProd.PrezzoBD - parseFloat(prezzoBdShopify) > 0 ? '+' : ''}${(fileProd.PrezzoBD - parseFloat(prezzoBdShopify)).toFixed(2)})</span>` : '';
        
        const scadenzaDiffDisplay = (fileProd && shopifyProd && (fileProd.Scadenza || '') !== scadenzaShopify) ? `<span class="text-warning"> (!)</span>` : '';
        
        const dittaDiffDisplay = (fileProd && shopifyProd && (fileProd.Ditta || '') !== dittaShopify) ? `<span class="text-warning"> (!)</span>` : '';

        const ivaDiffDisplay = (fileProd && shopifyProd && Math.abs(fileProd.IVA - parseFloat(ivaShopify)) > 0.001) ? `<span class="text-warning"> (!)</span>` : '';


        html += `
            <tr data-minsan="${fileProd?.Minsan || shopifyProd?.minsan || ''}"
                data-status="${status}"
                class="${status === 'sincronizzato' || status === 'sincronizzato (giacenza 0)' ? '' : status.replace(' ', '-')}">
                <td><input type="checkbox" class="product-checkbox" ${needsApproval ? '' : 'disabled'}></td>
                <td>${fileProd?.Minsan || shopifyProd?.minsan || '-'}</td>
                <td>${fileProd?.Descrizione || shopifyProd?.title || '-'}</td>
                <td>${fileProd?.Ditta || shopifyProd?.vendor || '-'} ${dittaDiffDisplay}</td> <td>${fileProd?.IVA || shopifyProd?.IVA || '-'} ${ivaDiffDisplay}</td> <td>${giacenzaFile} ${giacenzaDiffDisplay}</td>
                <td>${giacenzaShopify}</td>
                <td>${prezzoBdFile} ${prezzoBdDiffDisplay}</td>
                <td>${prezzoBdShopify}</td>
                <td>${scadenzaFile} ${scadenzaDiffDisplay}</td>
                <td>${scadenzaShopify}</td>
                <td><span class="status-indicator ${status}">${status.replace('-', ' ')}</span></td>
                <td>
                    ${needsApproval ? `<button class="btn secondary btn-preview" data-minsan="${fileProd?.Minsan || shopifyProd?.minsan || ''}" data-type="${status === 'nuovo' ? 'new-product' : status === 'modificato' ? 'modified-product' : 'shopify-only'}">Anteprima</button>` : ''}
                    ${needsApproval ? `<button class="btn primary btn-approve-single" data-minsan="${fileProd?.Minsan || shopifyProd?.minsan || ''}" data-action="${status === 'nuovo' ? 'add' : status === 'modificato' ? 'update' : 'zero-inventory'}">${status === 'nuovo' ? 'Aggiungi' : status === 'shopify-only' ? 'Azzera' : 'Approva'}</button>` : ''}
                </td>
            </tr>
        `;
    });


    html += `
            </tbody>
        </table>
        </div>
    `;
    tableContentPlaceholder.innerHTML = html;

    // Abilita/Disabilita i bottoni di approvazione (basato su ciò che è visibile e richiede approvazione)
    approveSelectedBtn.disabled = productsRequiringApprovalInView === 0;
    approveAllBtn.disabled = productsRequiringApprovalInView === 0;

    // Aggiungi listener per checkbox "seleziona tutto"
    const selectAllCheckbox = document.getElementById('selectAllProducts');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false; // Reset dello stato
        selectAllCheckbox.removeEventListener('change', handleSelectAll);
        selectAllCheckbox.addEventListener('change', handleSelectAll);
    }

    // Aggiungi listener per i bottoni "Anteprima" e "Approva" (delegazione)
    comparisonTableContainer.removeEventListener('click', handleTableActions);
    comparisonTableContainer.addEventListener('click', handleTableActions);

    // Gestori eventi per i bottoni di approvazione bulk
    approveSelectedBtn.removeEventListener('click', handleApproveSelected);
    approveSelectedBtn.addEventListener('click', handleApproveSelected);

    approveAllBtn.removeEventListener('click', handleApproveAll);
    approveAllBtn.addEventListener('click', handleApproveAll);
}

/**
 * Applica i filtri e la ricerca ai prodotti e renderizza la tabella.
 * Questa funzione verrà chiamata su input di ricerca e cambio filtro.
 */
function applyFiltersAndSearch() {
    const searchTerm = document.getElementById('comparisonProductSearch').value.toLowerCase();
    const statusFilter = document.getElementById('comparisonStatusFilter').value;
    
    let tempFilteredProducts = allComparisonProducts.filter(item => {
        // Filtra per stato
        if (statusFilter !== 'all') {
            if (statusFilter === 'non-importable' && item.type === 'non-importable-summary') return true;
            if (item.status !== statusFilter) return false;
        }

        // Filtra per ricerca (si applica solo ai prodotti reali, non al summary)
        if (item.type === 'non-importable-summary') { // Il riassunto appare solo se il filtro lo permette
            return true;
        }

        const minsan = String(item.fileData?.Minsan || item.shopifyData?.minsan || '').toLowerCase();
        const description = String(item.fileData?.Descrizione || item.shopifyData?.title || '').toLowerCase();
        const ditta = String(item.fileData?.Ditta || item.shopifyData?.vendor || '').toLowerCase();
        const ean = String(item.fileData?.EAN || item.shopifyData?.variants?.[0]?.barcode || '').toLowerCase();
        const iva = String(item.fileData?.IVA || item.shopifyData?.IVA || '').toLowerCase(); // Includi IVA nella ricerca

        return minsan.includes(searchTerm) ||
               description.includes(searchTerm) ||
               ditta.includes(searchTerm) || // Ricerca per Ditta
               ean.includes(searchTerm) ||
               iva.includes(searchTerm); // Ricerca per IVA
    });

    // Se il filtro non è su "non-importable" e il count è > 0, aggiungiamo la riga summary
    if (statusFilter !== 'non-importable') {
        const nonImportableSummary = allComparisonProducts.find(item => item.type === 'non-importable-summary');
        if (nonImportableSummary) {
            // Aggiungi il summary solo se non già presente e il filtro attuale non lo esclude esplicitamente
            if (!tempFilteredProducts.some(item => item.type === 'non-importable-summary')) {
                 tempFilteredProducts.push(nonImportableSummary);
                 // Ordina per mettere il summary alla fine
                 tempFilteredProducts.sort((a,b) => (a.type === 'non-importable-summary') ? 1 : (b.type === 'non-importable-summary' ? -1 : 0));
            }
        }
    }


    filteredComparisonProducts = tempFilteredProducts; // Aggiorna i prodotti filtrati globalmente
    renderFilteredComparisonTable(); // Ri-renderizza la tabella
}


function handleSelectAll(e) {
    document.querySelectorAll('.product-checkbox').forEach(checkbox => {
        if (!checkbox.disabled) {
            checkbox.checked = e.target.checked;
        }
    });
}

function handleTableActions(e) {
    // Ottieni il div di stato dell'uploader che sarà presente nella stessa tab
    const uploaderStatusDiv = document.getElementById('uploader-status');
    if (!uploaderStatusDiv) {
        console.error("Elemento 'uploader-status' non trovato per mostrare lo stato.");
        return;
    }

    if (e.target.classList.contains('btn-preview')) {
        const minsan = e.target.dataset.minsan;
        const type = e.target.dataset.type; // 'new-product', 'modified-product', 'shopify-only'
        const item = allComparisonProducts.find(p => (String(p.fileData?.Minsan || '').trim() === minsan || String(p.shopifyData?.minsan || '').trim() === minsan));
        
        if (item) {
            showProductPreviewModal(item.fileData?.Minsan || item.shopifyData?.minsan, item.fileData, item.shopifyData, item.status);
        } else {
            showUploaderStatus(uploaderStatusDiv, `Dati anteprima non trovati per Minsan: ${minsan}`, true);
        }
    } else if (e.target.classList.contains('btn-approve-single')) {
        const minsan = e.target.dataset.minsan;
        const action = e.target.dataset.action; // 'add', 'update', 'zero-inventory'
        showUploaderStatus(uploaderStatusDiv, `Richiesta di approvazione per Minsan: ${minsan} (Azione: ${action}) - Da implementare`, 'info');
        console.log('Approva singolo Minsan:', minsan, 'Azione:', action);
        // Qui dovrai chiamare la Netlify Function appropriata per l'approvazione singola
    }
}

function handleApproveSelected() {
    const uploaderStatusDiv = document.getElementById('uploader-status');
    const selectedMinsans = Array.from(document.querySelectorAll('.product-checkbox:checked:not(:disabled)'))
                            .map(cb => cb.closest('tr').dataset.minsan);
    if (selectedMinsans.length > 0) {
        showUploaderStatus(uploaderStatusDiv, `Approva selezionati (${selectedMinsans.length}) - Da implementare`, 'info');
        console.log('Approva selezionati:', selectedMinsans);
        // Qui la logica per l'approvazione bulk dei selezionati
    } else {
        showUploaderStatus(uploaderStatusDiv, 'Nessun prodotto selezionato per l\'approvazione.', true);
    }
}

function handleApproveAll() {
    const uploaderStatusDiv = document.getElementById('uploader-status');
    // Filtra solo i prodotti che richiedono approvazione (non sincronizzati e non il riassunto)
    const allPendingMinsans = filteredComparisonProducts
                                .filter(item => item.hasChanges && item.type !== 'non-importable-summary')
                                .map(item => item.fileData?.Minsan || item.shopifyData?.minsan);

    if (allPendingMinsans.length > 0) {
        showUploaderStatus(uploaderStatusDiv, `Approva tutti i ${allPendingMinsans.length} prodotti in attesa - Da implementare`, 'info');
        console.log('Approva tutto:', allPendingMinsans);
        // Qui la logica per l'approvazione bulk di tutti i prodotti in attesa
    } else {
        showUploaderStatus(uploaderStatusDiv, 'Nessun prodotto in attesa di approvazione.', true);
    }
}


/**
 * Mostra la modal di anteprima "Prima vs Dopo" per un prodotto.
 * Questa funzione è ora più robusta e cerca i dati da `allComparisonProducts`.
 * @param {string} minsan - Il codice Minsan del prodotto.
 * @param {object} fileProduct - L'oggetto prodotto dal file Excel (può essere null).
 * @param {object} shopifyProduct - L'oggetto prodotto da Shopify (può essere null).
 * @param {string} status - Lo stato del prodotto (es. 'nuovo', 'modificato', 'shopify-only').
 */
export function showProductPreviewModal(minsan, fileProduct, shopifyProduct, status) {
    const modalTitle = document.getElementById('preview-modal-title');
    const diffTbody = document.getElementById('preview-diff-tbody');
    let newApproveBtn = document.getElementById('preview-modal-approve-btn');

    if (!modalTitle || !diffTbody || !newApproveBtn || !document.getElementById('preview-modal-overlay')) {
        console.error("Elementi della modal di anteprima non trovati. Assicurarsi che 'preview-modal.html' sia caricato.");
        return;
    }

    // Per assicurarsi che i listener del bottone di approvazione siano unici
    const oldApproveBtn = newApproveBtn;
    newApproveBtn = oldApproveBtn.cloneNode(true);
    oldApproveBtn.parentNode.replaceChild(newApproveBtn, oldApproveBtn);

    // Listener per chiudere la modal
    document.getElementById('preview-modal-close-btn')?.addEventListener('click', () => hideModal('preview-modal-overlay'));
    document.getElementById('preview-modal-cancel-btn')?.addEventListener('click', () => hideModal('preview-modal-overlay'));


    let productTitle = fileProduct?.Descrizione || shopifyProduct?.title || 'Prodotto Sconosciuto';
    modalTitle.textContent = `Anteprima Modifiche per ${minsan} - "${productTitle}"`;

    diffTbody.innerHTML = ''; // Pulisce il contenuto precedente della tabella di confronto


    if (status === 'shopify-only') {
        const currentGiacenza = shopifyProduct?.variants[0]?.inventory_quantity ?? 0;
        const currentPrice = parseFloat(shopifyProduct?.variants[0]?.price ?? 0).toFixed(2);
        const currentScadenza = shopifyProduct?.Scadenza || '-';
        const currentDitta = shopifyProduct?.vendor || '-';
        const currentIVA = shopifyProduct?.IVA || '-'; // IVA da Shopify


        diffTbody.innerHTML = `
            <tr><td>Descrizione</td><td>${shopifyProduct?.title || '-'}</td><td>(Nessuna modifica)</td></tr>
            <tr><td>Ditta</td><td>${currentDitta}</td><td>(Nessuna modifica)</td></tr>
            <tr><td>IVA</td><td>${currentIVA}</td><td>(Nessuna modifica)</td></tr>
            <tr>
                <td>Giacenza</td>
                <td><span class="diff-original">${currentGiacenza}</span></td>
                <td><span class="diff-new">0 (Proposto)</span></td>
            </tr>
            <tr>
                <td>Prezzo BD</td>
                <td>${currentPrice}</td>
                <td>(Nessuna modifica)</td>
            </tr>
            <tr>
                <td>Scadenza</td>
                <td>${currentScadenza}</td>
                <td>(Nessuna modifica)</td>
            </tr>
            <tr><td colspan="3" style="font-style: italic;">Questo prodotto non è presente nel file Excel. Si propone di azzerare la sua giacenza su Shopify.</td></tr>
        `;
        newApproveBtn.textContent = 'Azzera Giacenza';
        newApproveBtn.dataset.action = 'zero-inventory';
        newApproveBtn.dataset.minsan = minsan;

    } else if (fileProd) { // Per 'nuovo' e 'modificato'
        const currentShopifyGiacenza = shopifyProduct?.variants[0]?.inventory_quantity ?? 0;
        const currentShopifyPrice = parseFloat(shopifyProduct?.variants[0]?.price ?? 0).toFixed(2);
        const currentShopifyScadenza = shopifyProduct?.Scadenza || '-';
        const currentShopifyDitta = shopifyProduct?.vendor || '-';
        const currentShopifyIVA = shopifyProduct?.IVA || '-';

        let giacenzaRow = `
            <td>Giacenza</td>
            <td>${shopifyProduct ? `<span class="diff-original">${currentShopifyGiacenza}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.Giacenza}</span></td>
        `;
        if (shopifyProduct && fileProd.Giacenza === currentShopifyGiacenza) {
            giacenzaRow = `<td>Giacenza</td><td colspan="2">${fileProd.Giacenza}</td>`;
        }

        let prezzoRow = `
            <td>Prezzo BD</td>
            <td>${shopifyProduct ? `<span class="diff-original">${currentShopifyPrice}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.PrezzoBD}</span></td>
        `;
        if (shopifyProduct && Math.abs(fileProd.PrezzoBD - parseFloat(currentShopifyPrice)) < 0.001) {
            prezzoRow = `<td>Prezzo BD</td><td colspan="2">${fileProd.PrezzoBD}</td>`;
        }

        let scadenzaRow = `
            <td>Scadenza</td>
            <td>${shopifyProduct ? `<span class="diff-original">${currentShopifyScadenza || '-'}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.Scadenza || '-'}</span></td>
        `;
        if (shopifyProduct && (fileProd.Scadenza || '') === (currentShopifyScadenza || '')) {
            scadenzaRow = `<td>Scadenza</td><td colspan="2">${fileProd.Scadenza || '-'}</td>`;
        }
        
        let dittaRow = `
            <td>Ditta</td>
            <td>${shopifyProduct ? `<span class="diff-original">${currentShopifyDitta}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.Ditta}</span></td>
        `;
        if (shopifyProduct && (fileProd.Ditta || '') === (currentShopifyDitta || '')) {
            dittaRow = `<td>Ditta</td><td colspan="2">${fileProd.Ditta}</td>`;
        }

        let ivaRow = `
            <td>IVA</td>
            <td>${shopifyProduct ? `<span class="diff-original">${currentShopifyIVA}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.IVA}</span></td>
        `;
        if (shopifyProduct && Math.abs(fileProd.IVA - parseFloat(currentShopifyIVA)) < 0.001) {
            ivaRow = `<td>IVA</td><td colspan="2">${fileProd.IVA}</td>`;
        }


        diffTbody.innerHTML = `
            <tr><td>EAN</td><td colspan="2">${fileProd.EAN || '-'}</td></tr>
            <tr><td>Descrizione</td><td colspan="2">${fileProd.Descrizione}</td></tr>
            <tr>${dittaRow}</tr>
            <tr>${ivaRow}</tr>
            <tr>${giacenzaRow}</tr>
            <tr>${prezzoRow}</tr>
            <tr>${scadenzaRow}</tr>
            <tr><td colspan="3" style="font-style: italic;">
                ${shopifyProduct ?
                    (status === 'modificato' ? 'Verranno applicate le modifiche ai campi evidenziati su Shopify.' : '') :
                    'Questo prodotto è nuovo e verrà creato su Shopify.'
                }
            </td></tr>
        `;
        newApproveBtn.textContent = shopifyProduct ? 'Approva Aggiornamento' : 'Crea Prodotto';
        newApproveBtn.dataset.action = shopifyProduct ? 'update' : 'add';
        newApproveBtn.dataset.minsan = minsan;

    } else { // Dovrebbe essere coperto dai casi sopra, ma per sicurezza
        diffTbody.innerHTML = '<tr><td colspan="3">Dati non disponibili per l\'anteprima.</td></tr>';
        newApproveBtn.disabled = true;
    }

    newApproveBtn.addEventListener('click', (e) => {
        const uploaderStatusDiv = document.getElementById('uploader-status');
        const action = e.target.dataset.action;
        const targetMinsan = e.target.dataset.minsan;
        showUploaderStatus(uploaderStatusDiv, `Approva singola dalla modal per ${targetMinsan} (Azione: ${action}) - Implementazione dell'invio API richiesta`, 'info');
        hideModal('preview-modal-overlay');
    });

    showModal('preview-modal-overlay');
}