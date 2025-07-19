// assets/js/comparison.js - COMPLETISSIMO E CORRETTO (Paginazione, Ricerca, Filtro, Metriche)

import { showModal, hideModal, showUploaderStatus } from './ui.js';

// Variabili globali per i dati originali e filtrati/cercati della tabella
let allComparisonProducts = []; // Tutti i prodotti da visualizzare (file + shopify, anche non importabili dal file)
let filteredComparisonProducts = []; // Prodotti attualmente visualizzati dopo filtri/ricerca

// Stato di paginazione per la tabella di confronto
let currentPage = 1;
const ITEMS_PER_PAGE = 20; // Numero di prodotti da mostrare per pagina
let totalPages = 1;

// Riferimenti agli elementi UI per i filtri e la paginazione (accessibili globalmente nel modulo)
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
let comparisonTableContainer; // Anche questo per i listener globali


/**
 * Normalizza un codice Minsan rimuovendo caratteri non alfanumerici e convertendo a maiuscolo.
 * Questa è una copia della funzione nel backend per coerenza lato frontend.
 * @param {string} minsan - Il codice Minsan da normalizzare.
 * @returns {string} Il codice Minsan normalizzato.
 */
function normalizeMinsan(minsan) {
    if (!minsan) return '';
    // Rimuove tutti i caratteri che non sono lettere o numeri, e converte a maiuscolo
    return String(minsan).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
}


/**
 * Inizializza i riferimenti agli elementi UI e i listener per la tabella di confronto.
 * Chiamato una volta dopo che il componente HTML è stato appeso.
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

    // Assicurati che tutti gli elementi siano stati trovati prima di aggiungere i listener
    if (!comparisonProductSearch || !comparisonStatusFilter || !comparisonPrevPageBtn || !comparisonNextPageBtn ||
        !comparisonPageInfo || !metricTotalRowsImported || !metricNewProducts || !metricProductsToModify ||
        !metricShopifyOnly || !metricNonImportable || !comparisonTableContainer) {
        console.error("[COMPARE] Alcuni elementi UI della tabella di confronto non sono stati trovati.");
        return false;
    }

    // --- Setup Listener per Ricerca e Filtro ---
    comparisonProductSearch.addEventListener('input', () => {
        currentPage = 1; // Resetta la paginazione ad ogni nuova ricerca/filtro
        applyFiltersAndSearch();
    });
    comparisonStatusFilter.addEventListener('change', () => {
        currentPage = 1; // Resetta la paginazione ad ogni nuova ricerca/filtro
        applyFiltersAndSearch();
    });

    // --- Setup Listener per Paginazione ---
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

    // --- Setup Listener per Anteprima/Approva (delegazione) ---
    // Rimuovi e riaggiungi per evitare duplicati se la funzione renderComparisonTable viene chiamata più volte
    comparisonTableContainer.removeEventListener('click', handleTableActions);
    comparisonTableContainer.addEventListener('click', handleTableActions);

    // Gestori eventi per i bottoni di approvazione bulk
    const approveSelectedBtn = document.getElementById('approve-selected-btn');
    const approveAllBtn = document.getElementById('approve-all-btn');
    if (approveSelectedBtn && approveAllBtn) {
        approveSelectedBtn.removeEventListener('click', handleApproveSelected);
        approveSelectedBtn.addEventListener('click', handleApproveSelected);
        approveAllBtn.removeEventListener('click', handleApproveAll);
        approveAllBtn.addEventListener('click', handleApproveAll);
    }
    
    return true; // UI setup riuscito
}


/**
 * Renderizza la tabella di confronto tra prodotti Excel e Shopify.
 * Questa è la funzione principale che riceve i dati elaborati.
 * @param {Array<object>} fileProducts - Prodotti elaborati dal file Excel (Minsan validi e non inizianti per 0).
 * @param {Array<object>} shopifyProducts - Prodotti recuperati da Shopify (garantito array).
 * @param {object} metrics - Oggetto con le metriche di riepilogo (da process-excel.js).
 */
export function renderComparisonTable(fileProducts, shopifyProducts, metrics) {
    // Assicurati che l'UI sia stata inizializzata una volta
    if (!comparisonTableContainer || !comparisonProductSearch) { // Controllo rapido se setupComparisonTableUI è già stato chiamato
        if (!setupComparisonTableUI()) {
            console.error("[COMPARE] Impossibile inizializzare la tabella di confronto: setup UI fallito.");
            return;
        }
    }

    comparisonTableContainer.classList.remove('hidden'); // Mostra il container della tabella

    // --- Aggiorna Metriche ---
    if (metrics) {
        metricTotalRowsImported.textContent = metrics.totalRowsImported;
        metricNewProducts.textContent = metrics.newProducts;
        metricProductsToModify.textContent = metrics.productsToModify;
        metricShopifyOnly.textContent = metrics.shopifyOnly;
        metricNonImportable.textContent = metrics.nonImportableMinsanZero;
    }

    const shopifyProductsArray = Array.isArray(shopifyProducts) ? shopifyProducts : [];

    // --- Prepara allComparisonProducts (struttura dati unificata per filtri/ricerca) ---
    allComparisonProducts = [];
    // Mappa i prodotti Shopify usando il Minsan normalizzato come chiave
    const shopifyProductsMap = new Map(shopifyProductsArray.map(p => [normalizeMinsan(p.minsan), p]));

    // Aggiungi prodotti dal file (con status)
    fileProducts.forEach(fileProd => {
        const minsan = normalizeMinsan(fileProd.Minsan); // Normalizza il Minsan dal file
        const shopifyProd = shopifyProductsMap.get(minsan);
        let status = 'sincronizzato'; // Default
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
                          (fileProd.Ditta || '') !== currentVendor || // Questa è la riga che può causare "modificato"
                          Math.abs(fileProd.CostoMedio - currentCostoMedio) > 0.001 ||
                          Math.abs(fileProd.IVA - currentIVA) > 0.001);

            if (hasChanges) {
                status = 'modificato';
            }
            shopifyProductsMap.delete(minsan); // Rimuovi dalla mappa Shopify per identificare i "Solo Shopify" dopo
        } else {
            status = 'nuovo';
        }
        allComparisonProducts.push({
            type: 'product', // Indica che è un prodotto reale
            fileData: fileProd,
            shopifyData: shopifyProd, // Potrebbe essere null se nuovo
            status: status,
            hasChanges: hasChanges
        });
    });

    // Aggiungi prodotti solo su Shopify
    shopifyProductsMap.forEach(shopifyProd => {
        if ((shopifyProd.variants[0]?.inventory_quantity ?? 0) > 0) { // Solo se giacenza > 0
            allComparisonProducts.push({
                type: 'product',
                fileData: null,
                shopifyData: shopifyProd,
                status: 'shopify-only',
                hasChanges: true // Sarà sempre "da azzerare"
            });
        } else {
            // Se giacenza 0, consideralo sincronizzato (non richiede azione)
             allComparisonProducts.push({
                type: 'product',
                fileData: null,
                shopifyData: shopifyProd,
                status: 'sincronizzato (giacenza 0)',
                hasChanges: false
            });
        }
    });

    // Aggiungi placeholder per i Minsan non importabili (per le metriche e il filtro)
    if (metrics.nonImportableMinsanZero > 0) {
        allComparisonProducts.push({
            type: 'non-importable-summary', // Tipo speciale per la riga di riepilogo
            status: 'non-importabile', // Coerenza con il value del filtro
            hasChanges: false,
            count: metrics.nonImportableMinsanZero
        });
    }

    // --- Esegui il primo filtro e renderizzazione con paginazione ---
    currentPage = 1; // Resetta la pagina corrente
    applyFiltersAndSearch(); // Applica i filtri iniziali e triggera il rendering


    // Disabilita i bottoni di approvazione se non ci sono prodotti che richiedono azione
    // Questo verrà aggiornato in renderFilteredComparisonTable
}


/**
 * Applica i filtri e la ricerca ai prodotti (dall'allComparisonProducts)
 * e aggiorna filteredComparisonProducts.
 * Questa funzione verrà chiamata su input di ricerca e cambio filtro.
 */
function applyFiltersAndSearch() {
    // Recupera i valori correnti dai campi UI
    const searchTerm = comparisonProductSearch.value.toLowerCase();
    const statusFilter = comparisonStatusFilter.value;
    
    let tempFilteredProducts = allComparisonProducts.filter(item => {
        // Filtra per stato
        if (statusFilter !== 'all') {
            // Se l'elemento è il riassunto non importabile, includilo solo se il filtro è 'non-importabile'
            if (item.type === 'non-importable-summary' && statusFilter === 'non-importabile') return true;
            // Altrimenti, filtra per lo stato effettivo del prodotto
            if (item.status !== statusFilter) return false;
        }

        // Se è un elemento di riepilogo, mostralo se non filtrato via dallo stato
        if (item.type === 'non-importable-summary') {
            return true;
        }

        // Filtra per ricerca (si applica solo ai prodotti reali, non al summary)
        const minsan = normalizeMinsan(item.fileData?.Minsan || item.shopifyData?.minsan); // Normalizza per la ricerca
        const description = String(item.fileData?.Descrizione || item.shopifyData?.title || '').toLowerCase();
        const ditta = String(item.fileData?.Ditta || item.shopifyData?.vendor || '').toLowerCase();
        const ean = String(item.fileData?.EAN || item.shopifyData?.variants?.[0]?.barcode || '').toLowerCase();
        const iva = String(item.fileData?.IVA || item.shopifyData?.IVA || '').toLowerCase();

        return minsan.includes(searchTerm) || // Ricerca per Minsan normalizzato
               description.includes(searchTerm) ||
               ditta.includes(searchTerm) ||
               ean.includes(searchTerm) ||
               iva.includes(searchTerm);
    });

    // Assicurati che l'elemento di riepilogo "non importabile" sia presente o rimosso correttamente
    const nonImportableSummaryItem = allComparisonProducts.find(item => item.type === 'non-importable-summary');
    if (nonImportableSummaryItem) {
        const isSummaryIncluded = tempFilteredProducts.some(item => item.type === 'non-importable-summary');
        const shouldBeIncludedByFilter = (statusFilter === 'all' || statusFilter === 'non-importabile');

        if (!isSummaryIncluded && shouldBeIncludedByFilter) {
            tempFilteredProducts.push(nonImportableSummaryItem);
        } else if (isSummaryIncluded && !shouldBeIncludedByFilter) {
            // Rimuovi se non dovrebbe essere incluso dal filtro di stato
            tempFilteredProducts = tempFilteredProducts.filter(item => item.type !== 'non-importable-summary');
        }
    }


    // Riordina per mettere il summary alla fine se presente
    tempFilteredProducts.sort((a,b) => {
        if (a.type === 'non-importable-summary') return 1;
        if (b.type === 'non-importable-summary') return -1;
        return 0;
    });


    filteredComparisonProducts = tempFilteredProducts; // Aggiorna i prodotti filtrati globalmente
    totalPages = Math.ceil(filteredComparisonProducts.length / ITEMS_PER_PAGE);
    if (totalPages === 0) totalPages = 1; // Almeno 1 pagina anche se vuota
    
    updatePaginationControls(); // Aggiorna i bottoni di paginazione
    renderFilteredComparisonTable(); // Ri-renderizza la tabella
}

/**
 * Aggiorna lo stato dei bottoni e del testo di paginazione.
 */
function updatePaginationControls() {
    comparisonPageInfo.textContent = `Pagina ${currentPage} di ${totalPages} (Totale: ${filteredComparisonProducts.length})`;
    comparisonPrevPageBtn.disabled = currentPage === 1;
    comparisonNextPageBtn.disabled = currentPage === totalPages;
}


/**
 * Renderizza solo i prodotti attualmente filtrati e cercati per la pagina corrente.
 */
function renderFilteredComparisonTable() {
    const tableContentPlaceholder = document.getElementById('table-content-placeholder');
    const approveSelectedBtn = document.getElementById('approve-selected-btn');
    const approveAllBtn = document.getElementById('approve-all-btn');

    if (!tableContentPlaceholder || !approveSelectedBtn || !approveAllBtn) return; // Doppia verifica

    // Calcola gli elementi da mostrare per la pagina corrente
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    let endIndex = startIndex + ITEMS_PER_PAGE;
    
    // Per gestire il summary item che deve stare sempre in fondo e non deve essere paginato via
    const nonImportableSummaryItem = filteredComparisonProducts.find(item => item.type === 'non-importable-summary');
    let itemsToRender = filteredComparisonProducts.slice(startIndex, endIndex);

    if (nonImportableSummaryItem && !itemsToRender.some(item => item.type === 'non-importable-summary')) { // Se il summary non è già nella slice
        // Se il summary esiste e la pagina corrente è l'ultima (o dovrebbe mostrare il summary)
        if (currentPage === totalPages) { // Solo se siamo all'ultima pagina
            itemsToRender.push(nonImportableSummaryItem);
            // Riordina per assicurarti che il summary sia l'ultimo elemento
            itemsToRender.sort((a,b) => (a.type === 'non-importable-summary') ? 1 : (b.type === 'non-importable-summary' ? -1 : 0));
        }
    }


    if (itemsToRender.length === 0) {
        tableContentPlaceholder.innerHTML = '<p>Nessun prodotto corrisponde ai criteri di ricerca/filtro per questa pagina.</p>';
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
                    <th>Ditta</th>
                    <th>IVA</th>
                    <th>Giacenza (File)</th>
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

    itemsToRender.forEach(item => {
        // Gestione riga di riepilogo "Non Importabile"
        if (item.type === 'non-importable-summary') {
            html += `
                <tr class="row-non-importable">
                    <td></td>
                    <td colspan="10" style="text-align: center; font-style: italic;">${item.count} prodotti non importabili (Minsan inizia per 0)</td>
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
        let dittaShopify = '-';
        let ivaShopify = '-';


        if (fileProd) {
            giacenzaFile = fileProd.Giacenza;
            prezzoBdFile = fileProd.PrezzoBD;
            scadenzaFile = fileProd.Scadenza || '-';
            dittaFile = fileProd.Ditta || '-';
            ivaFile = fileProd.IVA || '-';
        }

        if (shopifyProd) {
            giacenzaShopify = shopifyProd.variants[0]?.inventory_quantity ?? 0;
            prezzoBdShopify = parseFloat(shopifyProd.variants[0]?.price ?? 0).toFixed(2);
            scadenzaShopify = shopifyProd.Scadenza || '-';
            dittaShopify = shopifyProd.vendor || '-';
            ivaShopify = shopifyProd.IVA || '-';
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
                <td><input type="checkbox" id="checkbox-${fileProd?.Minsan || shopifyProd?.minsan}" class="product-checkbox" ${needsApproval ? '' : 'disabled'}></td>
                <td>${fileProd?.Minsan || shopifyProd?.minsan || '-'}</td>
                <td>${fileProd?.Descrizione || shopifyProd?.title || '-'}</td>
                <td>${fileProd?.Ditta || shopifyProd?.vendor || '-'} ${dittaDiffDisplay}</td>
                <td>${fileProd?.IVA || shopifyProd?.IVA || '-'} ${ivaDiffDisplay}</td>
                <td>${giacenzaFile} ${giacenzaDiffDisplay}</td>
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

    // Abilita/Disabilita i bottoni di approvazione (solo se ci sono prodotti che richiedono approvazione nella vista corrente)
    const hasPendingChangesInView = productsRequiringApprovalInView > 0;
    approveSelectedBtn.disabled = !hasPendingChangesInView;
    approveAllBtn.disabled = !hasPendingChangesInView;

    // Aggiungi listener per checkbox "seleziona tutto"
    const selectAllCheckbox = document.getElementById('selectAllProducts');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false; // Reset dello stato
        selectAllCheckbox.removeEventListener('change', handleSelectAll);
        selectAllCheckbox.addEventListener('change', handleSelectAll);
    }
}

/**
 * Gestione evento per checkbox "seleziona tutto".
 */
function handleSelectAll(e) {
    document.querySelectorAll('.product-checkbox').forEach(checkbox => {
        if (!checkbox.disabled) {
            checkbox.checked = e.target.checked;
        }
    });
}

/**
 * Gestione eventi per i bottoni "Anteprima" e "Approva" (delegazione sul container principale).
 */
function handleTableActions(e) {
    const uploaderStatusDiv = document.getElementById('uploader-status');
    if (!uploaderStatusDiv) {
        console.error("Elemento 'uploader-status' non trovato per mostrare lo stato.");
        return;
    }

    if (e.target.classList.contains('btn-preview')) {
        const minsan = e.target.dataset.minsan;
        const item = allComparisonProducts.find(p => normalizeMinsan(p.fileData?.Minsan || p.shopifyData?.minsan) === normalizeMinsan(minsan));
        
        if (item && item.type === 'product') { // Assicurati che sia un prodotto reale
            showProductPreviewModal(item.fileData?.Minsan || item.shopifyData?.minsan, item.fileData, item.shopifyData, item.status);
        } else {
            showUploaderStatus(uploaderStatusDiv, `Dati anteprima non trovati per Minsan: ${minsan}`, true);
        }
    } else if (e.target.classList.contains('btn-approve-single')) {
        const minsan = e.target.dataset.minsan;
        const action = e.target.dataset.action;
        showUploaderStatus(uploaderStatusDiv, `Richiesta di approvazione per Minsan: ${minsan} (Azione: ${action}) - Da implementare`, 'info');
        console.log('Approva singolo Minsan:', minsan, 'Azione:', action);
        // Qui la logica per l'approvazione singola via API
    }
}

/**
 * Gestione evento per l'approvazione dei prodotti selezionati.
 */
function handleApproveSelected() {
    const uploaderStatusDiv = document.getElementById('uploader-status');
    const selectedMinsans = Array.from(document.querySelectorAll('.product-checkbox:checked:not(:disabled)'))
                            .map(cb => cb.closest('tr').dataset.minsan);
    if (selectedMinsans.length > 0) {
        showUploaderStatus(uploaderStatusDiv, `Approva selezionati (${selectedMinsans.length}) - Da implementare`, 'info');
        console.log('Approva selezionati:', selectedMinsans);
        // Qui la logica per l'approvazione bulk dei selezionati via API
    } else {
        showUploaderStatus(uploaderStatusDiv, 'Nessun prodotto selezionato per l\'approvazione.', true);
    }
}

/**
 * Gestione evento per l'approvazione di tutte le modifiche.
 */
function handleApproveAll() {
    const uploaderStatusDiv = document.getElementById('uploader-status');
    // Filtra solo i prodotti che richiedono approvazione e non sono il riassunto
    const allPendingMinsans = filteredComparisonProducts
                                .filter(item => item.hasChanges && item.type === 'product')
                                .map(item => item.fileData?.Minsan || item.shopifyData?.minsan);

    if (allPendingMinsans.length > 0) {
        showUploaderStatus(uploaderStatusDiv, `Approva tutti i ${allPendingMinsans.length} prodotti in attesa - Da implementare`, 'info');
        console.log('Approva tutto:', allPendingMinsans);
        // Qui la logica per l'approvazione bulk di tutti i prodotti in attesa via API
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

    diffTbody.innerHTML = '';


    if (status === 'shopify-only') {
        const currentGiacenza = shopifyProd.variants[0]?.inventory_quantity ?? 0;
        const currentPrice = parseFloat(shopifyProd.variants[0]?.price ?? 0).toFixed(2);
        const currentScadenza = shopifyProd.Scadenza || '-';
        const currentDitta = shopifyProd.vendor || '-';
        const currentIVA = shopifyProd.IVA || '-';


        diffTbody.innerHTML = `
            <tr><td>Descrizione</td><td>${shopifyProd.title || '-'}</td><td>(Nessuna modifica)</td></tr>
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
        const currentShopifyGiacenza = shopifyProd?.variants[0]?.inventory_quantity ?? 0;
        const currentShopifyPrice = parseFloat(shopifyProd?.variants[0]?.price ?? 0).toFixed(2);
        const currentShopifyScadenza = shopifyProd?.Scadenza || '-';
        const currentShopifyDitta = shopifyProd?.vendor || '-';
        const currentShopifyIVA = shopifyProd?.IVA || '-';

        let giacenzaRow = `
            <td>Giacenza</td>
            <td>${shopifyProd ? `<span class="diff-original">${currentShopifyGiacenza}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.Giacenza}</span></td>
        `;
        if (shopifyProd && fileProd.Giacenza === currentShopifyGiacenza) {
            giacenzaRow = `<td>Giacenza</td><td colspan="2">${fileProd.Giacenza}</td>`;
        }

        let prezzoRow = `
            <td>Prezzo BD</td>
            <td>${shopifyProd ? `<span class="diff-original">${currentShopifyPrice}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.PrezzoBD}</span></td>
        `;
        if (shopifyProd && Math.abs(fileProd.PrezzoBD - parseFloat(currentShopifyPrice)) < 0.001) {
            prezzoRow = `<td>Prezzo BD</td><td colspan="2">${fileProd.PrezzoBD}</td>`;
        }

        let scadenzaRow = `
            <td>Scadenza</td>
            <td>${shopifyProd ? `<span class="diff-original">${currentShopifyScadenza || '-'}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.Scadenza || '-'}</span></td>
        `;
        if (shopifyProd && (fileProd.Scadenza || '') === (currentShopifyScadenza || '')) {
            scadenzaRow = `<td>Scadenza</td><td colspan="2">${fileProd.Scadenza || '-'}</td>`;
        }
        
        let dittaRow = `
            <td>Ditta</td>
            <td>${shopifyProd ? `<span class="diff-original">${currentShopifyDitta}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.Ditta}</span></td>
        `;
        if (shopifyProd && (fileProd.Ditta || '') === (currentShopifyDitta || '')) {
            dittaRow = `<td>Ditta</td><td colspan="2">${fileProd.Ditta}</td>`;
        }

        let ivaRow = `
            <td>IVA</td>
            <td>${shopifyProd ? `<span class="diff-original">${currentShopifyIVA}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProd.IVA}</span></td>
        `;
        if (shopifyProd && Math.abs(fileProd.IVA - parseFloat(currentShopifyIVA)) < 0.001) {
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
                ${shopifyProd ?
                    (status === 'modificato' ? 'Verranno applicate le modifiche ai campi evidenziati su Shopify.' : '') :
                    'Questo prodotto è nuovo e verrà creato su Shopify.'
                }
            </td></tr>
        `;
        newApproveBtn.textContent = shopifyProd ? 'Approva Aggiornamento' : 'Crea Prodotto';
        newApproveBtn.dataset.action = shopifyProd ? 'update' : 'add';
        newApproveBtn.dataset.minsan = minsan;

    } else {
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