// assets/js/comparison.js - COMPLETO E CORRETTO

import { showModal, hideModal, showUploaderStatus } from './ui.js';

/**
 * Renderizza la tabella di confronto tra prodotti Excel e Shopify.
 * @param {Array<object>} fileProducts - Prodotti elaborati dal file Excel.
 * @param {Array<object>} shopifyProducts - Prodotti recuperati da Shopify.
 */
export function renderComparisonTable(fileProducts, shopifyProducts) {
    const comparisonTableContainer = document.getElementById('comparison-table-container');
    const tableContentPlaceholder = document.getElementById('table-content-placeholder');
    const approveSelectedBtn = document.getElementById('approve-selected-btn');
    const approveAllBtn = document.getElementById('approve-all-btn');

    if (!comparisonTableContainer || !tableContentPlaceholder || !approveSelectedBtn || !approveAllBtn) {
        console.error("Contenitori della tabella di confronto o bottoni di approvazione non trovati. Assicurarsi che 'comparison-table.html' sia caricato correttamente.");
        return;
    }

    comparisonTableContainer.classList.remove('hidden');
    tableContentPlaceholder.innerHTML = ''; // Pulisce il contenuto precedente

    if (fileProducts.length === 0 && shopifyProducts.length === 0) {
        tableContentPlaceholder.innerHTML = '<p>Nessun dato da confrontare.</p>';
        approveSelectedBtn.disabled = true;
        approveAllBtn.disabled = true;
        return;
    }

    let html = `
        <div class="table-responsive">
        <table class="data-table">
            <thead>
                <tr>
                    <th><input type="checkbox" id="selectAllProducts"></th>
                    <th>Minsan</th>
                    <th>Descrizione</th>
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

    const shopifyProductsMap = new Map();
    shopifyProducts.forEach(p => {
        // Usa il campo 'minsan' normalizzato come chiave per il lookup
        const minsanKey = String(p.minsan).trim();
        shopifyProductsMap.set(minsanKey, p);
    });

    let productsToApproveCount = 0;
    const allRelevantMinsans = new Set(); // Per tenere traccia di tutti i minsan da processare

    // Aggiungi tutti i minsan dal file
    fileProducts.forEach(p => allRelevantMinsans.add(String(p.Minsan).trim()));
    // Aggiungi tutti i minsan da Shopify che non sono nel file (potrebbero essere da azzerare)
    shopifyProducts.forEach(p => {
        const minsanKey = String(p.minsan).trim();
        // Solo se il minsan non è già presente dal file e la giacenza Shopify è > 0
        if (!allRelevantMinsans.has(minsanKey) && (p.variants[0]?.inventory_quantity ?? 0) > 0) {
            allRelevantMinsans.add(minsanKey);
        }
    });

    // Ordina i minsan per una visualizzazione coerente
    const sortedMinsans = Array.from(allRelevantMinsans).sort();

    for (const minsan of sortedMinsans) {
        const fileProd = fileProducts.find(p => String(p.Minsan).trim() === minsan);
        const shopifyProd = shopifyProductsMap.get(minsan);

        let status = '';
        let giacenzaFile = '-';
        let giacenzaShopify = '-';
        let prezzoBdFile = '-';
        let prezzoBdShopify = '-';
        let scadenzaFile = '-';
        let scadenzaShopify = '-';
        let giacenzaDiffDisplay = '';
        let prezzoBdDiffDisplay = '';
        let scadenzaDiffDisplay = '';
        let needsApproval = false;
        let actionButtonsHtml = '';

        if (fileProd && shopifyProd) {
            // Prodotto presente in entrambi: confronta
            giacenzaFile = fileProd.Giacenza;
            giacenzaShopify = shopifyProd.variants[0]?.inventory_quantity ?? 0;
            prezzoBdFile = fileProd.PrezzoBD;
            prezzoBdShopify = parseFloat(shopifyProd.variants[0]?.price ?? 0).toFixed(2);
            scadenzaFile = fileProd.Scadenza || '-';
            scadenzaShopify = shopifyProd.Scadenza || '-';

            const giacenzaDiff = fileProd.Giacenza - giacenzaShopify;
            const prezzoBdDiff = (fileProd.PrezzoBD - parseFloat(prezzoBdShopify));
            const scadenzaChanged = (fileProd.Scadenza || '') !== (scadenzaShopify || '');

            const hasChanges = (giacenzaDiff !== 0 || Math.abs(prezzoBdDiff) > 0.001 || scadenzaChanged);

            if (hasChanges) {
                status = 'Modificato';
                needsApproval = true;
                giacenzaDiffDisplay = giacenzaDiff !== 0 ? `<span class="${giacenzaDiff > 0 ? 'text-success' : 'text-danger'}">(${giacenzaDiff > 0 ? '+' : ''}${giacenzaDiff})</span>` : '';
                prezzoBdDiffDisplay = Math.abs(prezzoBdDiff) > 0.001 ? `<span class="${prezzoBdDiff > 0 ? 'text-success' : 'text-danger'}">(${prezzoBdDiff > 0 ? '+' : ''}${prezzoBdDiff.toFixed(2)})</span>` : '';
                scadenzaDiffDisplay = scadenzaChanged ? `<span class="text-warning"> (!)</span>` : '';
                actionButtonsHtml = `
                    <button class="btn secondary btn-preview" data-minsan="${minsan}" data-type="modified-product">Anteprima</button>
                    <button class="btn primary btn-approve-single" data-minsan="${minsan}" data-action="update">Approva</button>
                `;
            } else {
                status = 'Sincronizzato';
                actionButtonsHtml = `<span style="color: var(--success-color);">Sincronizzato</span>`;
            }

        } else if (fileProd && !shopifyProd) {
            // Prodotto presente solo nel file: nuovo prodotto
            status = 'Nuovo';
            needsApproval = true;
            giacenzaFile = fileProd.Giacenza;
            prezzoBdFile = fileProd.PrezzoBD;
            scadenzaFile = fileProd.Scadenza || '-';
            actionButtonsHtml = `
                <button class="btn secondary btn-preview" data-minsan="${minsan}" data-type="new-product">Anteprima</button>
                <button class="btn primary btn-approve-single" data-minsan="${minsan}" data-action="add">Aggiungi</button>
            `;

        } else if (!fileProd && shopifyProd) {
            // Prodotto presente solo su Shopify: candidato per azzeramento
            const currentGiacenza = shopifyProd.variants[0]?.inventory_quantity ?? 0;
            if (currentGiacenza > 0) { // Solo se la giacenza attuale è > 0
                status = 'Solo Shopify';
                needsApproval = true;
                giacenzaFile = `0 <span class="text-danger">(Proposto)</span>`;
                giacenzaShopify = currentGiacenza;
                prezzoBdShopify = parseFloat(shopifyProd.variants[0]?.price ?? 0).toFixed(2);
                scadenzaShopify = shopifyProd.Scadenza || '-';
                actionButtonsHtml = `
                    <button class="btn secondary btn-preview" data-minsan="${minsan}" data-type="shopify-only">Anteprima</button>
                    <button class="btn primary btn-approve-single" data-minsan="${minsan}" data-action="zero-inventory">Azzera</button>
                `;
            } else {
                // Prodotto solo su Shopify ma già a giacenza 0, non richiede azione
                status = 'Sincronizzato (Giacenza 0)';
                giacenzaShopify = 0;
                prezzoBdShopify = parseFloat(shopifyProd.variants[0]?.price ?? 0).toFixed(2);
                scadenzaShopify = shopifyProd.Scadenza || '-';
                 actionButtonsHtml = `<span style="color: var(--gray-dark);">Non richiede azione</span>`;
            }
        }

        if (status) {
            if (needsApproval) productsToApproveCount++;
            html += `
                <tr data-minsan="${minsan}" data-status="${status.toLowerCase().replace(' ', '-')}" class="${status === 'Sincronizzato' || status === 'Sincronizzato (Giacenza 0)' ? '' : status.toLowerCase().replace(' ', '-')}">
                    <td><input type="checkbox" class="product-checkbox" ${needsApproval ? '' : 'disabled'}></td>
                    <td>${minsan}</td>
                    <td>${fileProd?.Descrizione || shopifyProd?.title || '-'}</td>
                    <td>${giacenzaFile} ${giacenzaDiffDisplay}</td>
                    <td>${giacenzaShopify}</td>
                    <td>${prezzoBdFile} ${prezzoBdDiffDisplay}</td>
                    <td>${prezzoBdShopify}</td>
                    <td>${scadenzaFile} ${scadenzaDiffDisplay}</td>
                    <td>${scadenzaShopify}</td>
                    <td><span class="status-indicator ${status.toLowerCase().replace(' ', '-')}">${status}</span></td>
                    <td>${actionButtonsHtml}</td>
                </tr>
            `;
        }
    }


    html += `
            </tbody>
        </table>
        </div>
    `;
    tableContentPlaceholder.innerHTML = html;

    // Abilita/Disabilita i bottoni di approvazione
    const hasPendingChanges = productsToApproveCount > 0;
    approveSelectedBtn.disabled = !hasPendingChanges;
    approveAllBtn.disabled = !hasPendingChanges;

    // Aggiungi listener per checkbox "seleziona tutto" (rimosso il vecchio e aggiunto il nuovo)
    const selectAllCheckbox = document.getElementById('selectAllProducts');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false; // Reset dello stato
        selectAllCheckbox.removeEventListener('change', handleSelectAll); // Rimuovi listener precedente
        selectAllCheckbox.addEventListener('change', handleSelectAll);
    }

    // Aggiungi listener per i bottoni "Anteprima" (deleghiamo l'evento al container della tabella)
    comparisonTableContainer.removeEventListener('click', handleTableActions); // Rimuovi il listener precedente per evitare duplicati
    comparisonTableContainer.addEventListener('click', handleTableActions);

    // Gestori eventi per i bottoni di approvazione bulk
    approveSelectedBtn.removeEventListener('click', handleApproveSelected);
    approveSelectedBtn.addEventListener('click', handleApproveSelected);

    approveAllBtn.removeEventListener('click', handleApproveAll);
    approveAllBtn.addEventListener('click', handleApproveAll);
}

function handleSelectAll(e) {
    document.querySelectorAll('.product-checkbox').forEach(checkbox => {
        if (!checkbox.disabled) {
            checkbox.checked = e.target.checked;
        }
    });
}

function handleTableActions(e) {
    if (e.target.classList.contains('btn-preview')) {
        const minsan = e.target.dataset.minsan;
        const type = e.target.dataset.type; // 'new-product', 'modified-product', 'shopify-only'
        const fileProduct = window.currentFileProducts.find(p => String(p.Minsan).trim() === minsan);
        const shopifyProduct = window.currentShopifyProducts.find(p => String(p.minsan).trim() === minsan);
        showProductPreviewModal(minsan, fileProduct, shopifyProduct, type);
    } else if (e.target.classList.contains('btn-approve-single')) {
        const minsan = e.target.dataset.minsan;
        const action = e.target.dataset.action; // 'add', 'update', 'zero-inventory'
        showUploaderStatus(document.getElementById('uploader-status'), `Richiesta di approvazione per Minsan: ${minsan} (Azione: ${action}) - Da implementare`, 'info');
        console.log('Approva singolo Minsan:', minsan, 'Azione:', action);
        // Qui dovrai chiamare la Netlify Function appropriata per l'approvazione singola
    }
}

function handleApproveSelected() {
    const selectedMinsans = Array.from(document.querySelectorAll('.product-checkbox:checked:not(:disabled)'))
                            .map(cb => cb.closest('tr').dataset.minsan);
    if (selectedMinsans.length > 0) {
        showUploaderStatus(document.getElementById('uploader-status'), `Approva selezionati (${selectedMinsans.length}) - Da implementare`, 'info');
        console.log('Approva selezionati:', selectedMinsans);
        // Qui la logica per l'approvazione bulk dei selezionati
    } else {
        showUploaderStatus(document.getElementById('uploader-status'), 'Nessun prodotto selezionato per l\'approvazione.', true);
    }
}

function handleApproveAll() {
    // Filtra solo i prodotti che richiedono approvazione
    const allPendingMinsans = Array.from(document.querySelectorAll('.data-table tbody tr'))
                                .filter(row => row.querySelector('.product-checkbox:not(:disabled)'))
                                .map(row => row.dataset.minsan);
    if (allPendingMinsans.length > 0) {
        showUploaderStatus(document.getElementById('uploader-status'), `Approva tutti i ${allPendingMinsans.length} prodotti in attesa - Da implementare`, 'info');
        console.log('Approva tutto:', allPendingMinsans);
        // Qui la logica per l'approvazione bulk di tutti i prodotti in attesa
    } else {
        showUploaderStatus(document.getElementById('uploader-status'), 'Nessun prodotto in attesa di approvazione.', true);
    }
}


/**
 * Mostra la modal di anteprima "Prima vs Dopo" per un prodotto.
 * @param {string} minsan - Il codice Minsan del prodotto.
 * @param {object} fileProduct - L'oggetto prodotto dal file Excel.
 * @param {object} shopifyProduct - L'oggetto prodotto da Shopify.
 * @param {string} type - 'new-product', 'modified-product', 'shopify-only'.
 */
export function showProductPreviewModal(minsan, fileProduct, shopifyProduct, type) {
    const modalTitle = document.getElementById('preview-modal-title');
    const diffTbody = document.getElementById('preview-diff-tbody');
    const approveBtn = document.getElementById('preview-modal-approve-btn');
    const modalOverlay = document.getElementById('preview-modal-overlay');

    if (!modalTitle || !diffTbody || !approveBtn || !modalOverlay) {
        console.error("Elementi della modal di anteprima non trovati. Assicurarsi che 'preview-modal.html' sia caricato.");
        return;
    }

    // Rimuovi vecchi listener per evitare duplicati, clonando il bottone
    // Questa è una tecnica per rimuovere tutti i listener associati a un elemento specifico
    const oldApproveBtn = approveBtn.cloneNode(true);
    approveBtn.parentNode.replaceChild(oldApproveBtn, approveBtn);
    const newApproveBtn = document.getElementById('preview-modal-approve-btn'); // Recupera il riferimento al nuovo bottone

    // Listener per chiudere la modal
    // Usiamo ?. per evitare errori se gli elementi non esistono (ma a questo punto dovrebbero)
    document.getElementById('preview-modal-close-btn')?.addEventListener('click', () => hideModal('preview-modal-overlay'));
    document.getElementById('preview-modal-cancel-btn')?.addEventListener('click', () => hideModal('preview-modal-overlay'));


    let productTitle = fileProduct?.Descrizione || shopifyProduct?.title || 'Prodotto Sconosciuto';
    modalTitle.textContent = `Anteprima Modifiche per ${minsan} - "${productTitle}"`;


    if (type === 'shopify-only') {
        // Anteprima per azzeramento giacenza (prodotto solo su Shopify)
        const currentGiacenza = shopifyProduct?.variants[0]?.inventory_quantity ?? 0;
        const currentPrice = parseFloat(shopifyProduct?.variants[0]?.price ?? 0).toFixed(2);
        const currentScadenza = shopifyProduct?.Scadenza || '-';

        diffTbody.innerHTML = `
            <tr><td>Descrizione</td><td>${shopifyProduct?.title || '-'}</td><td>(Nessuna modifica)</td></tr>
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

    } else if (fileProd) {
        // Anteprima per nuovo prodotto o modifica da file
        const currentShopifyGiacenza = shopifyProduct?.variants[0]?.inventory_quantity ?? 0;
        const currentShopifyPrice = parseFloat(shopifyProduct?.variants[0]?.price ?? 0).toFixed(2);
        const currentShopifyScadenza = shopifyProduct?.Scadenza || '-';

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


        diffTbody.innerHTML = `
            <tr><td>Ditta</td><td colspan="2">${fileProd.Ditta}</td></tr>
            <tr><td>EAN</td><td colspan="2">${fileProd.EAN || '-'}</td></tr>
            <tr><td>Descrizione</td><td colspan="2">${fileProd.Descrizione}</td></tr>
            <tr>${giacenzaRow}</tr>
            <tr>${prezzoRow}</tr>
            <tr>${scadenzaRow}</tr>
            <tr><td>IVA</td><td colspan="2">${fileProd.IVA}%</td></tr>
            <tr><td colspan="3" style="font-style: italic;">
                ${shopifyProduct ?
                    (type === 'modified-product' ? 'Verranno applicate le modifiche ai campi evidenziati su Shopify.' : '') :
                    'Questo prodotto è nuovo e verrà creato su Shopify.'
                }
            </td></tr>
        `;
        newApproveBtn.textContent = shopifyProduct ? 'Approva Aggiornamento' : 'Crea Prodotto';
        newApproveBtn.dataset.action = shopifyProduct ? 'update' : 'add';
        newApproveBtn.dataset.minsan = minsan;

    } else {
        diffTbody.innerHTML = '<tr><td colspan="3">Dati non disponibili per l\'anteprima.</td></tr>';
        newApproveBtn.disabled = true;
    }

    // Listener per il bottone di approvazione nella modal (usiamo il nuovo bottone)
    newApproveBtn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const targetMinsan = e.target.dataset.minsan;
        // Questa chiamata deve essere gestita in main.js o tramite un gestore eventi globale
        showUploaderStatus(document.getElementById('uploader-status'), `Approva singola dalla modal per ${targetMinsan} (Azione: ${action}) - Implementazione dell'invio API richiesta`, 'info');
        hideModal('preview-modal-overlay');
    });

    showModal('preview-modal-overlay');
}