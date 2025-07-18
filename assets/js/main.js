import { loadComponent, showNotification } from './utils.js';

let currentFileProducts = []; // Per tenere traccia dei prodotti dal file Excel
let currentShopifyProducts = []; // Per tenere traccia dei prodotti da Shopify

document.addEventListener('DOMContentLoaded', async () => {
    // Carica i componenti UI nella sezione designata
    await loadComponent('file-uploader', 'file-uploader-section');
    await loadComponent('comparison-table', 'comparison-table-section');

    // Inizializza la logica per l'uploader
    initializeFileUploader();

    // Inizializza la navigazione a tab
    initializeTabNavigation();
});

function initializeTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabContents.forEach(content => {
                if (content.id === `${targetTab}-tab`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });
}

function initializeFileUploader() {
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('fileInput');
    const selectFileBtn = document.getElementById('selectFileBtn');
    const progressBarContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const fileNameSpan = document.getElementById('file-name');
    const uploadStatusDiv = document.getElementById('upload-status'); // Riferimento al div dello stato

    const updateProgress = (percentage, fileName = '') => {
        progressBarContainer.classList.remove('hidden');
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `${percentage}%`;
        if (fileName) fileNameSpan.textContent = `(${fileName})`;
    };

    const showUploaderStatus = (message, isError = false) => {
        uploadStatusDiv.textContent = message;
        uploadStatusDiv.className = `upload-status ${isError ? 'error' : ''}`;
        uploadStatusDiv.classList.remove('hidden');
        if (!isError) { // Nasconde progress bar solo per successo, non per errore
            progressBarContainer.classList.add('hidden');
        }
    };

    // Gestione Drag & Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('highlight'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('highlight'), false);
    });

    dropArea.addEventListener('drop', handleDrop, false);

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }

    // Gestione selezione file da input
    selectFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    async function handleFiles(files) {
        if (files.length === 0) {
            showUploaderStatus('Nessun file selezionato.', true);
            return;
        }

        const file = files[0];
        if (!file.name.endsWith('.xls') && !file.name.endsWith('.xlsx')) {
            showUploaderStatus('Formato file non supportato. Carica un file .xls o .xlsx.', true);
            return;
        }

        showUploaderStatus('Caricamento ed elaborazione in corso...', false);
        updateProgress(0, file.name);

        const formData = new FormData();
        formData.append('excelFile', file);

        try {
            const response = await fetch('/.netlify/functions/process-excel', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Errore durante l\'elaborazione del file.');
            }

            const data = await response.json();
            updateProgress(100, file.name);
            showUploaderStatus('File elaborato con successo! Dati caricati per il confronto.', false);

            currentFileProducts = data.processedProducts;
            currentShopifyProducts = data.shopifyProducts;

            // Renderizza la tabella di confronto
            renderComparisonTable(currentFileProducts, currentShopifyProducts);

        } catch (error) {
            console.error('Errore durante l\'upload o l\'elaborazione:', error);
            showUploaderStatus(`Errore: ${error.message}`, true);
            updateProgress(0); // Resetta la progress bar in caso di errore
        }
    }
}

function renderComparisonTable(fileProducts, shopifyProducts) {
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
        // Normalizza il minsan di Shopify per il confronto
        shopifyProductsMap.set(String(p.variants[0].sku || p.id).trim(), p);
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

        if (shopifyProd) {
            giacenzaShopify = shopifyProd.variants[0].inventory_quantity || 0;
            // Assumi che il prezzo BD di Shopify sia nel `price` del primo variant
            prezzoBdShopify = parseFloat(shopifyProd.variants[0].price || 0).toFixed(2);
            scadenzaShopify = shopifyProd.metafields?.find(m => m.key === 'scadenza')?.value || '-'; // Esempio: scadenza come metafield

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

        const giacenzaDiffDisplay = giacenzaDiff !== 0 ? `<span class="${giacenzaDiff > 0 ? 'text-success' : 'text-danger'}">${giacenzaDiff > 0 ? '+' : ''}${giacenzaDiff}</span>` : '';
        const prezzoBdDiffDisplay = Math.abs(prezzoBdDiff) > 0.001 ? `<span class="${prezzoBdDiff > 0 ? 'text-success' : 'text-danger'}">${prezzoBdDiff > 0 ? '+' : ''}${prezzoBdDiff.toFixed(2)}</span>` : '';

        html += `
            <tr data-minsan="${fileMinsan}" class="${status === 'Sincronizzato' ? '' : status === 'Nuovo' ? 'row-new' : 'row-modified'}">
                <td><input type="checkbox" class="product-checkbox" ${status === 'Sincronizzato' ? 'disabled' : ''}></td>
                <td>${fileMinsan}</td>
                <td>${fileProd.Descrizione}</td>
                <td>${fileProd.Giacenza} ${giacenzaDiffDisplay}</td>
                <td>${giacenzaShopify}</td>
                <td>${fileProd.PrezzoBD} ${prezzoBdDiffDisplay}</td>
                <td>${prezzoBdShopify}</td>
                <td>${fileProd.Scadenza || '-'}</td>
                <td>${scadenzaShopify}</td>
                <td><span class="status-indicator ${status.toLowerCase().replace(' ', '-')}">${status}</span></td>
                <td>
                    <button class="btn secondary btn-preview" data-minsan="${fileMinsan}">Anteprima</button>
                    ${status !== 'Sincronizzato' ? `<button class="btn primary btn-approve-single" data-minsan="${fileMinsan}">Approva</button>` : ''}
                </td>
            </tr>
        `;
    });

    // Aggiungi i prodotti che sono solo su Shopify (candidati per giacenza = 0)
    shopifyProductsMap.forEach(shopifyProd => {
        const shopifyMinsan = String(shopifyProd.variants[0].sku || shopifyProd.id).trim();
        const currentGiacenza = shopifyProd.variants[0].inventory_quantity || 0;
        const currentPrice = parseFloat(shopifyProd.variants[0].price || 0).toFixed(2);
        const currentScadenza = shopifyProd.metafields?.find(m => m.key === 'scadenza')?.value || '-';

        if (currentGiacenza > 0) { // Solo se la giacenza attuale è > 0, altrimenti non c'è da azzerare
            productsToApproveCount++;
            html += `
                <tr data-minsan="${shopifyMinsan}" class="row-shopify-only">
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
                        <button class="btn secondary btn-preview" data-minsan="${shopifyMinsan}">Anteprima</button>
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

    // Abilita i bottoni di approvazione se ci sono modifiche
    if (productsToApproveCount > 0) {
        approveSelectedBtn.disabled = false;
        approveAllBtn.disabled = false;
    } else {
        approveSelectedBtn.disabled = true;
        approveAllBtn.disabled = true;
    }

    // Aggiungi listener per checkbox "seleziona tutto"
    document.getElementById('selectAllProducts')?.addEventListener('change', (e) => {
        document.querySelectorAll('.product-checkbox').forEach(checkbox => {
            if (!checkbox.disabled) { // Solo i checkbox non disabilitati
                checkbox.checked = e.target.checked;
            }
        });
    });

    // Placeholder per la logica dei bottoni "Anteprima" e "Approva"
    document.querySelectorAll('.btn-preview').forEach(button => {
        button.addEventListener('click', (e) => {
            const minsan = e.target.dataset.minsan;
            // Qui andrebbe la logica per mostrare la modal "Prima/Dopo"
            showNotification(`Anteprima per Minsan: ${minsan}`, 'info');
            console.log('Anteprima per Minsan:', minsan);
        });
    });

    document.querySelectorAll('.btn-approve-single').forEach(button => {
        button.addEventListener('click', (e) => {
            const minsan = e.target.dataset.minsan;
            const action = e.target.dataset.action || 'update'; // 'update' o 'zero-inventory'
            // Qui andrebbe la logica per l'approvazione singola
            showNotification(`Richiesta di approvazione per Minsan: ${minsan} (Azione: ${action})`, 'info');
            console.log('Approva singolo Minsan:', minsan, 'Azione:', action);
        });
    });
}