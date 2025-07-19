// assets/js/main.js - COMPLETO E CORRETTO (Passaggio Metrice a renderComparisonTable)

import { loadComponent, initializeTabNavigation } from './ui.js';
import { initializeFileUploader } from './uploader.js';
import { renderComparisonTable } from './comparison.js';
import { initializeShopifyProductsTab } from './shopify-products.js';
import { initializeCompanyManagerTab } from './company-manager.js';

// Variabili globali per i dati, usate tra i moduli
window.currentFileProducts = [];
window.currentShopifyProducts = [];
window.allShopifyProducts = null;
window.currentShopifyPageProducts = [];

// Funzione di inizializzazione specifica per la tab "Importa/Aggiorna Prodotti"
// Questa funzione viene chiamata quando la tab "Importa/Aggiorna" è attiva (all'avvio o al click).
async function initializeImportUpdateTab() {
    console.log("[MAIN] Inizializzazione tab 'Importa/Aggiorna Prodotti'...");
    
    const fileUploaderSection = document.getElementById('file-uploader-section');
    if (!fileUploaderSection) {
        console.error("[MAIN] initializeImportUpdateTab: Sezione uploader (file-uploader-section) non trovata.");
        return;
    }

    // Ottieni i riferimenti agli elementi UI dell'uploader *dopo* che sono stati appesi.
    const dropArea = fileUploaderSection.querySelector('#drop-area');
    const fileInput = fileUploaderSection.querySelector('#fileInput');
    const selectFileBtn = fileUploaderSection.querySelector('#selectFileBtn');
    const uploaderStatusDiv = fileUploaderSection.querySelector('#uploader-status');
    const progressBarContainer = fileUploaderSection.querySelector('#progress-container');
    const progressBar = fileUploaderSection.querySelector('#progress-bar');
    const progressText = fileUploaderSection.querySelector('#progress-text');
    const fileNameSpan = fileUploaderSection.querySelector('#file-name');

    if (dropArea && fileInput && selectFileBtn && uploaderStatusDiv && progressBarContainer && progressBar && progressText && fileNameSpan) {
        // Inizializza l'uploader passando tutti i riferimenti agli elementi
        initializeFileUploader({
            dropArea: dropArea,
            fileInput: fileInput,
            selectFileBtn: selectFileBtn,
            uploaderStatusDiv: uploaderStatusDiv,
            progressBarContainer: progressBarContainer,
            progressBar: progressBar,
            progressText: progressText,
            fileNameSpan: fileNameSpan,
            // *** MODIFICA QUI: Aggiungi metrics come argomento della callback ***
            onUploadSuccess: async (processedProducts, shopifyProducts, metrics) => {
                window.currentFileProducts = processedProducts;
                window.currentShopifyProducts = shopifyProducts;
                // *** MODIFICA QUI: Passa metrics a renderComparisonTable ***
                renderComparisonTable(processedProducts, shopifyProducts, metrics); 
            }
        });
        console.log("[MAIN] Uploader inizializzato con successo in initializeImportUpdateTab.");
    } else {
        console.error("[MAIN] initializeImportUpdateTab: Impossibile trovare uno o più elementi UI dell'uploader. La funzionalità di upload potrebbe non essere attiva.", {
            dropArea, fileInput, selectFileBtn, uploaderStatusDiv, progressBarContainer, progressBar, progressText, fileNameSpan
        });
    }
}


document.addEventListener('DOMContentLoaded', async () => {
    console.log("[MAIN] DOMContentLoaded avviato.");
    // 1. Ottieni i riferimenti ai contenitori principali (devono esistere in index.html)
    const fileUploaderSection = document.getElementById('file-uploader-section');
    const comparisonTableSection = document.getElementById('comparison-table-section');
    const modalContainer = document.getElementById('modal-container');
    const shopifyProductsTabContent = document.getElementById('shopify-products-tab');
    const companyManagerTabContent = document.getElementById('company-manager-tab');


    // Verifica che i contenitori esistano prima di procedere
    if (!fileUploaderSection || !comparisonTableSection || !modalContainer || !shopifyProductsTabContent || !companyManagerTabContent) {
        console.error("[MAIN] ERRORE CRITICO: Uno o più sezioni principali dell'applicazione non sono state trovate in index.html. Assicurati che gli ID siano corretti.", {
            fileUploaderSection, comparisonTableSection, modalContainer, shopifyProductsTabContent, companyManagerTabContent
        });
        return;
    }
    console.log("[MAIN] Tutti i contenitori principali trovati.");

    // 2. Carica i DocumentFragment dei componenti e appendili ai rispettivi contenitori.
    // Effettua il append IMMEDIATAMENTE dopo il caricamento per garantire che siano nel DOM.

    // Carica il componente Uploader
    const uploaderFragment = await loadComponent('file-uploader');
    if (uploaderFragment) {
        fileUploaderSection.innerHTML = ''; // Pulisci il contenitore prima di appendere
        fileUploaderSection.appendChild(uploaderFragment);
        console.log("[MAIN] Componente 'file-uploader' appeso con successo.");
    } else {
        console.error("[MAIN] ERRORE CRITICO: Impossibile caricare il DocumentFragment del componente 'file-uploader'. La funzionalità di upload non sarà disponibile.");
        return;
    }

    // Carica il componente Comparison Table
    const comparisonFragment = await loadComponent('comparison-table');
    if (comparisonFragment) {
        comparisonTableSection.innerHTML = '';
        comparisonTableSection.appendChild(comparisonFragment);
        console.log("[MAIN] Componente 'comparison-table' appeso con successo.");
    } else {
        console.error("[MAIN] ERRORE: Impossibile caricare il DocumentFragment del componente 'comparison-table'.");
    }

    // Carica il componente Preview Modal
    const previewModalFragment = await loadComponent('preview-modal');
    if (previewModalFragment) {
        modalContainer.innerHTML = '';
        modalContainer.appendChild(previewModalFragment);
        console.log("[MAIN] Componente 'preview-modal' appeso con successo.");
    } else {
        console.error("[MAIN] ERRORE: Impossibile caricare il DocumentFragment del componente 'preview-modal'.");
    }

    // Carica il componente della tabella Prodotti Shopify
    const shopifyProductsTableFragment = await loadComponent('shopify-products-table');
    if (shopifyProductsTableFragment) {
        shopifyProductsTabContent.innerHTML = '';
        shopifyProductsTabContent.appendChild(shopifyProductsTableFragment);
        console.log("[MAIN] Componente 'shopify-products-table' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'shopify-products-table'.");
    }

    // Carica il componente della tab Gestione Ditte
    const companyManagerFragment = await loadComponent('company-manager-tab');
    if (companyManagerFragment) {
        companyManagerTabContent.innerHTML = '';
        companyManagerTabContent.appendChild(companyManagerFragment);
        console.log("[MAIN] Componente 'company-manager-tab' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'company-manager-tab'.");
    }

    console.log("[MAIN] Tutti i componenti HTML appesi.");

    // 3. Inizializza la logica di navigazione a tab, registrando le callback
    initializeTabNavigation({
        'import-update': initializeImportUpdateTab,
        'shopify-products': initializeShopifyProductsTab,
        'company-manager': initializeCompanyManagerTab
    });
    console.log("[MAIN] Navigazione a tab inizializzata con callback registrate.");

    // La initializeTabNavigation gestirà l'attivazione della callback iniziale.
});