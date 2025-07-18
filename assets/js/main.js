// assets/js/main.js - COMPLETO E CORRETTO (AGGIORNATO PER NUOVA TAB DITTE)

import { loadComponent, initializeTabNavigation } from './ui.js';
import { initializeFileUploader } from './uploader.js';
import { renderComparisonTable } from './comparison.js';
import { initializeShopifyProductsTab } from './shopify-products.js';
// Importa il nuovo modulo per la gestione delle ditte
import { initializeCompanyManagerTab } from './company-manager.js';

// Variabili globali per i dati, usate tra i moduli
window.currentFileProducts = [];
window.currentShopifyProducts = [];
window.allShopifyProducts = null;
window.currentShopifyPageProducts = [];

// Funzione di inizializzazione specifica per la tab "Importa/Aggiorna Prodotti"
async function initializeImportUpdateTab() {
    console.log("Inizializzazione tab 'Importa/Aggiorna Prodotti'...");
    
    const fileUploaderSection = document.getElementById('file-uploader-section');

    const dropArea = fileUploaderSection.querySelector('#drop-area');
    const fileInput = fileUploaderSection.querySelector('#fileInput');
    const selectFileBtn = fileUploaderSection.querySelector('#selectFileBtn');
    const uploaderStatusDiv = fileUploaderSection.querySelector('#uploader-status');
    const progressBarContainer = fileUploaderSection.querySelector('#progress-container');
    const progressBar = fileUploaderSection.querySelector('#progress-bar');
    const progressText = fileUploaderSection.querySelector('#progress-text');
    const fileNameSpan = fileUploaderSection.querySelector('#file-name');

    if (dropArea && fileInput && selectFileBtn && uploaderStatusDiv && progressBarContainer && progressBar && progressText && fileNameSpan) {
        initializeFileUploader({
            dropArea: dropArea,
            fileInput: fileInput,
            selectFileBtn: selectFileBtn,
            uploaderStatusDiv: uploaderStatusDiv,
            progressBarContainer: progressBarContainer,
            progressBar: progressBar,
            progressText: progressText,
            fileNameSpan: fileNameSpan,
            onUploadSuccess: async (processedProducts, shopifyProducts) => {
                window.currentFileProducts = processedProducts;
                window.currentShopifyProducts = shopifyProducts;
                renderComparisonTable(processedProducts, shopifyProducts);
            }
        });
        console.log("Uploader inizializzato con successo in initializeImportUpdateTab.");
    } else {
        console.error("initializeImportUpdateTab: Impossibile trovare uno o più elementi UI dell'uploader. La funzionalità di upload potrebbe non essere attiva.", {
            dropArea, fileInput, selectFileBtn, uploaderStatusDiv, progressBarContainer, progressBar, progressText, fileNameSpan
        });
    }
}


document.addEventListener('DOMContentLoaded', async () => {
    // 1. Ottieni i riferimenti ai contenitori principali (devono esistere in index.html)
    const fileUploaderSection = document.getElementById('file-uploader-section');
    const comparisonTableSection = document.getElementById('comparison-table-section');
    const modalContainer = document.getElementById('modal-container');
    const shopifyProductsTabContent = document.getElementById('shopify-products-tab');
    // NUOVO: Riferimento al contenitore della tab Gestione Ditte
    const companyManagerTabContent = document.getElementById('company-manager-tab');


    // Verifica che i contenitori esistano prima di procedere
    if (!fileUploaderSection || !comparisonTableSection || !modalContainer || !shopifyProductsTabContent || !companyManagerTabContent) {
        console.error("ERRORE CRITICO: Uno o più sezioni principali dell'applicazione non sono state trovate in index.html. Assicurati che gli ID siano corretti.");
        return;
    }

    // 2. Carica i DocumentFragment dei componenti e appendili ai rispettivi contenitori.

    // Carica il componente Uploader
    const uploaderFragment = await loadComponent('file-uploader');
    if (uploaderFragment) {
        fileUploaderSection.innerHTML = '';
        fileUploaderSection.appendChild(uploaderFragment);
        console.log("Componente 'file-uploader' appeso con successo.");
    } else {
        console.error("ERRORE CRITICO: Impossibile caricare il DocumentFragment del componente 'file-uploader'. La funzionalità di upload non sarà disponibile.");
        return;
    }

    // Carica il componente Comparison Table
    const comparisonFragment = await loadComponent('comparison-table');
    if (comparisonFragment) {
        comparisonTableSection.innerHTML = '';
        comparisonTableSection.appendChild(comparisonFragment);
        console.log("Componente 'comparison-table' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'comparison-table'.");
    }

    // Carica il componente Preview Modal
    const previewModalFragment = await loadComponent('preview-modal');
    if (previewModalFragment) {
        modalContainer.innerHTML = '';
        modalContainer.appendChild(previewModalFragment);
        console.log("Componente 'preview-modal' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'preview-modal'.");
    }

    // Carica il componente della tabella Prodotti Shopify
    const shopifyProductsTableFragment = await loadComponent('shopify-products-table');
    if (shopifyProductsTableFragment) {
        shopifyProductsTabContent.innerHTML = '';
        shopifyProductsTabContent.appendChild(shopifyProductsTableFragment);
        console.log("Componente 'shopify-products-table' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'shopify-products-table'.");
    }

    // NUOVO: Carica il componente della tab Gestione Ditte
    const companyManagerFragment = await loadComponent('company-manager-tab');
    if (companyManagerFragment) {
        companyManagerTabContent.innerHTML = ''; // Pulisci il contenitore della tab
        companyManagerTabContent.appendChild(companyManagerFragment);
        console.log("Componente 'company-manager-tab' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'company-manager-tab'.");
    }


    // 3. Inizializza la logica di navigazione a tab, registrando le callback
    initializeTabNavigation({
        'import-update': initializeImportUpdateTab,
        'shopify-products': initializeShopifyProductsTab,
        'company-manager': initializeCompanyManagerTab // REGISTRA LA NUOVA CALLBACK PER LA TAB DITTE
        // 'change-log': initializeChangeLogTab
    });

    // La initializeTabNavigation ora gestisce l'attivazione della callback iniziale.
});