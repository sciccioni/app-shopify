// comparison.js - Logica per la visualizzazione e interazione della tabella di confronto

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

    if (!comparisonTableContainer || !tableContentPlaceholder) {
        console.error("Contenitori della tabella di confronto non trovati.");
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
        const minsan = String(p.minsan || p.variants?.[0]?.sku || p.id).trim();
        shopifyProductsMap.set(minsan, p);
    });

    let productsToApproveCount = 0;

    // Itera sui prodotti dal file Excel
    fileProducts.forEach(fileProd => {
        const fileMinsan = String(fileProd.Minsan).trim();
        const shopifyProd = shopifyProductsMap.get(fileMinsan);

        let status = 'Nuovo';
        let giacenzaShopify = '-';
        let prezzoBdShopify = '-';
        let scadenzaShopify = '-';
        let giacenzaDiff = 0;
        let prezzoBdDiff = 0;
        let hasChanges = false;

        // Se il prodotto esiste anche su Shopify
        if (shopifyProd) {
            giacenzaShopify = shopifyProd.variants[0]?.inventory_quantity ?? 0;
            prezzoBdShopify = parseFloat(shopifyProd.variants[0]?.price ?? 0).toFixed(2);
            scadenzaShopify = shopifyProd.Scadenza || '-'; // Scadenza dal metafield mappato

            giacenzaDiff = fileProd.Giacenza - giacenzaShopify;
            prezzoBdDiff = (fileProd.PrezzoBD - parseFloat(prezzoBdShopify));

            hasChanges = (giacenzaDiff !== 0 || Math.abs(prezzoBdDiff) > 0.001 || (fileProd.Scadenza && fileProd.Scadenza !== scadenzaShopify));

            if (!hasChanges) {
                status = 'Sincronizzato';
            } else {
                status = 'Modificato';
                productsToApproveCount++;
            }
            // Rimuovi dalla mappa per identificare i prodotti solo in Shopify
            shopifyProductsMap.delete(fileMinsan);
        } else {
            productsToApproveCount++; // Un nuovo prodotto richiede approvazione
        }

        const giacenzaDiffDisplay = giacenzaDiff !== 0 ? `<span class="${giacenzaDiff > 0 ? 'text-success' : 'text-danger'}">(${giacenzaDiff > 0 ? '+' : ''}${giacenzaDiff})</span>` : '';
        const prezzoBdDiffDisplay = Math.abs(prezzoBdDiff) > 0.001 ? `<span class="${prezzoBdDiff > 0 ? 'text-success' : 'text-danger'}">(${prezzoBdDiff > 0 ? '+' : ''}${prezzoBdDiff.toFixed(2)})</span>` : '';
        const scadenzaDiffDisplay = (fileProd.Scadenza && fileProd.Scadenza !== scadenzaShopify) ? `<span class="text-warning">(!)</span>` : '';


        html += `
            <tr data-minsan="${fileMinsan}"
                data-status="${status.toLowerCase().replace(' ', '-')}"
                class="${status === 'Sincronizzato' ? '' : status === 'Nuovo' ? 'row-new' : 'row-modified'}">
                <td><input type="checkbox" class="product-checkbox" ${status === 'Sincronizzato' ? 'disabled' : ''}></td>
                <td>${fileMinsan}</td>
                <td>${fileProd.Descrizione}</td>
                <td>${fileProd.Giacenza} ${giacenzaDiffDisplay}</td>
                <td>${giacenzaShopify}</td>
                <td>${fileProd.PrezzoBD} ${prezzoBdDiffDisplay}</td>
                <td>${prezzoBdShopify}</td>
                <td>${fileProd.Scadenza || '-'} ${scadenzaDiffDisplay}</td>
                <td>${scadenzaShopify}</td>
                <td><span class="status-indicator ${status.toLowerCase().replace(' ', '-')}">${status}</span></td>
                <td>
                    ${status !== 'Sincronizzato' ? `<button class="btn secondary btn-preview" data-minsan="${fileMinsan}" data-type="file-product">Anteprima</button>` : ''}
                    ${status !== 'Sincronizzato' ? `<button class="btn primary btn-approve-single" data-minsan="${fileMinsan}" data-action="${status === 'Nuovo' ? 'add' : 'update'}">Approva</button>` : ''}
                </td>
            </tr>
        `;
    });

    // Aggiungi i prodotti che sono solo su Shopify (candidati per giacenza = 0)
    shopifyProductsMap.forEach(shopifyProd => {
        const shopifyMinsan = String(shopifyProd.minsan).trim();
        const currentGiacenza = shopifyProd.variants[0]?.inventory_quantity ?? 0;
        const currentPrice = parseFloat(shopifyProd.variants[0]?.price ?? 0).toFixed(2);
        const currentScadenza = shopifyProd.Scadenza || '-';

        if (currentGiacenza > 0) { // Solo se la giacenza attuale è > 0, altrimenti non c'è da azzerare
            productsToApproveCount++;
            html += `
                <tr data-minsan="${shopifyMinsan}" data-status="shopify-only" class="row-shopify-only">
                    <td><input type="checkbox" class="product-checkbox"></td>
                    <td>${shopifyMinsan}</td>
                    <td>${shopifyProd.title}</td>
                    <td>0 <span class="text-danger">(Proposto)</span></td>
                    <td>${currentGiacenza}</td>
                    <td>-</td>
                    <td>${currentPrice}</td>
                    <td>-</td>
                    <td>${currentScadenza}</td>
                    <td><span class="status-indicator shopify-only">Solo Shopify</span></td>
                    <td>
                        <button class="btn secondary btn-preview" data-minsan="${shopifyMinsan}" data-type="shopify-only">Anteprima</button>
                        <button class="btn primary btn-approve-single" data-minsan="${shopifyMinsan}" data-action="zero-inventory">Azzera</button>
                    </td>
                </tr>
            `;
        }
    });


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

    // Aggiungi listener per checkbox "seleziona tutto"
    document.getElementById('selectAllProducts')?.addEventListener('change', (e) => {
        document.querySelectorAll('.product-checkbox').forEach(checkbox => {
            if (!checkbox.disabled) {
                checkbox.checked = e.target.checked;
            }
        });
    });

    // Aggiungi listener per i bottoni "Anteprima"
    document.querySelectorAll('.btn-preview').forEach(button => {
        button.addEventListener('click', (e) => {
            const minsan = e.target.dataset.minsan;
            const type = e.target.dataset.type; // 'file-product' o 'shopify-only'
            const fileProduct = window.currentFileProducts.find(p => String(p.Minsan).trim() === minsan);
            const shopifyProduct = window.currentShopifyProducts.find(p => String(p.minsan).trim() === minsan);
            showProductPreviewModal(minsan, fileProduct, shopifyProduct, type);
        });
    });

    // Aggiungi listener per i bottoni "Approva Singola"
    document.querySelectorAll('.btn-approve-single').forEach(button => {
        button.addEventListener('click', (e) => {
            const minsan = e.target.dataset.minsan;
            const action = e.target.dataset.action; // 'add', 'update', 'zero-inventory'
            // Qui invocheremo una funzione per gestire l'approvazione singola
            showUploaderStatus(`Richiesta di approvazione per Minsan: ${minsan} (Azione: ${action}) - Da implementare`, 'info');
            console.log('Approva singolo Minsan:', minsan, 'Azione:', action);
        });
    });

    // Listener per i bottoni di approvazione bulk
    approveSelectedBtn.addEventListener('click', () => {
        const selectedMinsans = Array.from(document.querySelectorAll('.product-checkbox:checked:not(:disabled)'))
                                .map(cb => cb.closest('tr').dataset.minsan);
        if (selectedMinsans.length > 0) {
            showUploaderStatus(`Approva selezionati (${selectedMinsans.length}) - Da implementare`, 'info');
            console.log('Approva selezionati:', selectedMinsans);
        } else {
            showUploaderStatus('Nessun prodotto selezionato per l\'approvazione.', true);
        }
    });

    approveAllBtn.addEventListener('click', () => {
        // Filtra solo quelli che richiedono approvazione (non sincronizzati)
        const allPendingMinsans = Array.from(document.querySelectorAll('.data-table tbody tr'))
                                    .filter(row => row.dataset.status !== 'sincronizzato')
                                    .map(row => row.dataset.minsan);
        if (allPendingMinsans.length > 0) {
            showUploaderStatus(`Approva tutti i ${allPendingMinsans.length} prodotti in attesa - Da implementare`, 'info');
            console.log('Approva tutto:', allPendingMinsans);
        } else {
            showUploaderStatus('Nessun prodotto in attesa di approvazione.', true);
        }
    });
}


/**
 * Mostra la modal di anteprima "Prima vs Dopo" per un prodotto.
 * @param {string} minsan - Il codice Minsan del prodotto.
 * @param {object} fileProduct - L'oggetto prodotto dal file Excel.
 * @param {object} shopifyProduct - L'oggetto prodotto da Shopify.
 * @param {string} type - 'file-product' (nuovo/modificato da file) o 'shopify-only' (da azzerare).
 */
export function showProductPreviewModal(minsan, fileProduct, shopifyProduct, type) {
    const modalTitle = document.getElementById('preview-modal-title');
    const diffTbody = document.getElementById('preview-diff-tbody');
    const approveBtn = document.getElementById('preview-modal-approve-btn');

    if (!modalTitle || !diffTbody || !approveBtn) {
        console.error("Elementi della modal di anteprima non trovati.");
        return;
    }

    modalTitle.textContent = `${minsan} - ${fileProduct?.Descrizione || shopifyProduct?.title || 'Dettagli Prodotto'}`;
    diffTbody.innerHTML = ''; // Pulisce il contenuto precedente

    if (type === 'shopify-only') {
        // Anteprima per azzeramento giacenza
        const currentGiacenza = shopifyProduct?.variants[0]?.inventory_quantity ?? 0;
        const currentPrice = parseFloat(shopifyProduct?.variants[0]?.price ?? 0).toFixed(2);
        const currentScadenza = shopifyProduct?.Scadenza || '-';

        diffTbody.innerHTML = `
            <tr><td>Descrizione</td><td colspan="2">${shopifyProduct?.title || '-'}</td></tr>
            <tr>
                <td>Giacenza</td>
                <td><span class="diff-original">${currentGiacenza}</span></td>
                <td><span class="diff-new">0 (Proposto)</span></td>
            </tr>
            <tr>
                <td>Prezzo BD</td>
                <td>${currentPrice}</td>
                <td>-</td>
            </tr>
            <tr>
                <td>Scadenza</td>
                <td>${currentScadenza}</td>
                <td>-</td>
            </tr>
            <tr><td colspan="3">Questo prodotto non è presente nel file Excel. Si propone di azzerare la sua giacenza su Shopify.</td></tr>
        `;
        approveBtn.textContent = 'Azzera Giacenza';
        approveBtn.dataset.action = 'zero-inventory';
        approveBtn.dataset.minsan = minsan;

    } else if (fileProduct) {
        // Anteprima per nuovo prodotto o modifica
        const currentShopifyGiacenza = shopifyProduct?.variants[0]?.inventory_quantity ?? 0;
        const currentShopifyPrice = parseFloat(shopifyProduct?.variants[0]?.price ?? 0).toFixed(2);
        const currentShopifyScadenza = shopifyProduct?.Scadenza || '-';

        let giacenzaRow = `
            <td>Giacenza</td>
            <td>${shopifyProduct ? `<span class="diff-original">${currentShopifyGiacenza}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProduct.Giacenza}</span></td>
        `;
        if (shopifyProduct && fileProduct.Giacenza === currentShopifyGiacenza) {
            giacenzaRow = `<td>Giacenza</td><td colspan="2">${fileProduct.Giacenza}</td>`;
        }


        let prezzoRow = `
            <td>Prezzo BD</td>
            <td>${shopifyProduct ? `<span class="diff-original">${currentShopifyPrice}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProduct.PrezzoBD}</span></td>
        `;
        if (shopifyProduct && Math.abs(fileProduct.PrezzoBD - parseFloat(currentShopifyPrice)) < 0.001) {
            prezzoRow = `<td>Prezzo BD</td><td colspan="2">${fileProduct.PrezzoBD}</td>`;
        }

        let scadenzaRow = `
            <td>Scadenza</td>
            <td>${shopifyProduct ? `<span class="diff-original">${currentShopifyScadenza}</span>` : 'N.D.'}</td>
            <td><span class="diff-new">${fileProduct.Scadenza || '-'}</span></td>
        `;
        if (shopifyProduct && (fileProduct.Scadenza || '') === (currentShopifyScadenza || '')) {
            scadenzaRow = `<td>Scadenza</td><td colspan="2">${fileProduct.Scadenza || '-'}</td>`;
        }


        diffTbody.innerHTML = `
            <tr><td>Ditta</td><td colspan="2">${fileProduct.Ditta}</td></tr>
            <tr><td>EAN</td><td colspan="2">${fileProduct.EAN || '-'}</td></tr>
            <tr><td>Descrizione</td><td colspan="2">${fileProduct.Descrizione}</td></tr>
            <tr>${giacenzaRow}</tr>
            <tr>${prezzoRow}</tr>
            <tr>${scadenzaRow}</tr>
            <tr><td>IVA</td><td colspan="2">${fileProduct.IVA}%</td></tr>
            ${shopifyProduct ? '' : '<tr><td colspan="3">Questo prodotto è nuovo e verrà creato su Shopify.</td></tr>'}
        `;
        approveBtn.textContent = shopifyProduct ? 'Approva Aggiornamento' : 'Crea Prodotto';
        approveBtn.dataset.action = shopifyProduct ? 'update' : 'add';
        approveBtn.dataset.minsan = minsan;

    } else {
        diffTbody.innerHTML = '<tr><td colspan="3">Dati non disponibili per l\'anteprima.</td></tr>';
        approveBtn.disabled = true;
    }

    // Listener per i bottoni della modal
    document.getElementById('preview-modal-close-btn')?.addEventListener('click', () => hideModal('preview-modal-overlay'), { once: true });
    document.getElementById('preview-modal-cancel-btn')?.addEventListener('click', () => hideModal('preview-modal-overlay'), { once: true });
    approveBtn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        const targetMinsan = e.target.dataset.minsan;
        // Qui dovremmo invocare una funzione di approvazione globale o re-dispatchare un evento
        showUploaderStatus(`Approva singola dalla modal per ${targetMinsan} (Azione: ${action}) - Da implementare`, 'info');
        hideModal('preview-modal-overlay');
    }, { once: true }); // Usiamo once per evitare listener multipli ad ogni apertura

    showModal('preview-modal-overlay');
}