// assets/js/main.js - COMPLETO E CORRETTO (RIFINITO PER INIZIALIZZAZIONE TAB E UPLOADER)

import { loadComponent, initializeTabNavigation } from './ui.js';
import { initializeFileUploader } from './uploader.js';
import { renderComparisonTable } from './comparison.js';
import { initializeShopifyProductsTab } from './shopify-products.js'; // Importa il modulo per la tab Prodotti Shopify

// Variabili globali per i dati, usate tra i moduli
window.currentFileProducts = [];
window.currentShopifyProducts = [];
window.allShopifyProducts = null; // Inizialmente null, verrà popolato al primo accesso alla tab Prodotti Shopify
window.currentShopifyPageProducts = []; // I prodotti della pagina corrente della tab Shopify

// Funzione di inizializzazione specifica per la tab "Importa/Aggiorna Prodotti"
// Questa funzione viene chiamata quando la tab "Importa/Aggiorna" è attiva (all'avvio o al click).
async function initializeImportUpdateTab() {
    console.log("Inizializzazione tab 'Importa/Aggiorna Prodotti'...");
    
    const fileUploaderSection = document.getElementById('file-uploader-section');

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
    const shopifyProductsTabContent = document.getElementById('shopify-products-tab'); // Contenitore per la tab dei prodotti Shopify


    // Verifica che i contenitori esistano prima di procedere
    if (!fileUploaderSection || !comparisonTableSection || !modalContainer || !shopifyProductsTabContent) {
        console.error("ERRORE CRITICO: Uno o più sezioni principali dell'applicazione non sono state trovate in index.html. Assicurati che gli ID siano corretti.");
        return; // Non possiamo continuare senza i contenitori base
    }

    // 2. Carica i DocumentFragment dei componenti e appendili ai rispettivi contenitori.
    // Effettua il append IMMEDIATAMENTE dopo il caricamento per garantire che siano nel DOM.

    // Carica il componente Uploader
    const uploaderFragment = await loadComponent('file-uploader');
    if (uploaderFragment) {
        fileUploaderSection.innerHTML = ''; // Pulisci il contenitore prima di appendere
        fileUploaderSection.appendChild(uploaderFragment);
        console.log("Componente 'file-uploader' appeso con successo.");
    } else {
        console.error("ERRORE CRITICO: Impossibile caricare il DocumentFragment del componente 'file-uploader'. La funzionalità di upload non sarà disponibile.");
        return; // Se l'uploader non carica, fermiamo qui
    }

    // Carica il componente Comparison Table
    const comparisonFragment = await loadComponent('comparison-table');
    if (comparisonFragment) {
        comparisonTableSection.innerHTML = ''; // Pulisci
        comparisonTableSection.appendChild(comparisonFragment);
        console.log("Componente 'comparison-table' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'comparison-table'.");
    }

    // Carica il componente Preview Modal
    const previewModalFragment = await loadComponent('preview-modal');
    if (previewModalFragment) {
        modalContainer.innerHTML = ''; // Pulisci
        modalContainer.appendChild(previewModalFragment);
        console.log("Componente 'preview-modal' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'preview-modal'.");
    }

    // NUOVO: Carica il componente della tabella Prodotti Shopify (solo append, inizializzazione alla selezione tab)
    const shopifyProductsTableFragment = await loadComponent('shopify-products-table');
    if (shopifyProductsTableFragment) {
        shopifyProductsTabContent.innerHTML = ''; // Pulisci il contenitore della tab
        shopifyProductsTabContent.appendChild(shopifyProductsTableFragment);
        console.log("Componente 'shopify-products-table' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'shopify-products-table'.");
    }


    // 3. Inizializza la logica di navigazione a tab, registrando le callback
    initializeTabNavigation({
        'import-update': initializeImportUpdateTab, // Registra la callback per la tab di upload
        'shopify-products': initializeShopifyProductsTab // Registra la callback per la tab Prodotti Shopify
        // 'change-log': initializeChangeLogTab // Se avrai una callback per la tab Change Log
    });

    // La initializeTabNavigation ora gestisce l'attivazione della callback iniziale.
    // Non abbiamo bisogno di chiamare initializeImportUpdateTab() qui direttamente.
});