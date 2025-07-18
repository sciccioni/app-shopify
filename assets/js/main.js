// assets/js/main.js - COMPLETO E CORRETTO

import { loadComponent, initializeTabNavigation } from './ui.js';
import { initializeFileUploader } from './uploader.js';
import { renderComparisonTable } from './comparison.js';
// Importa il nuovo modulo per la gestione della tab Prodotti Shopify
import { initializeShopifyProductsTab } from './shopify-products.js';

// Variabili globali per i dati, usate tra i moduli
window.currentFileProducts = [];
window.currentShopifyProducts = [];
// Nuova variabile globale per memorizzare tutti i prodotti Shopify
window.allShopifyProducts = null; // Inizialmente null, verrà popolato al primo accesso alla tab

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Ottieni i riferimenti ai contenitori principali (devono esistere in index.html)
    const fileUploaderSection = document.getElementById('file-uploader-section');
    const comparisonTableSection = document.getElementById('comparison-table-section');
    const modalContainer = document.getElementById('modal-container');
    // Riferimento al contenitore della tab Prodotti Shopify
    const shopifyProductsTabContent = document.getElementById('shopify-products-tab');


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

    // NUOVO: Carica il componente della tabella Prodotti Shopify
    const shopifyProductsTableFragment = await loadComponent('shopify-products-table');
    if (shopifyProductsTableFragment) {
        // Appendi al div della tab Prodotti Shopify, non al suo contenuto interno
        shopifyProductsTabContent.innerHTML = ''; // Pulisci il contenitore della tab
        shopifyProductsTabContent.appendChild(shopifyProductsTableFragment);
        console.log("Componente 'shopify-products-table' appeso con successo.");
    } else {
        console.error("ERRORE: Impossibile caricare il DocumentFragment del componente 'shopify-products-table'.");
    }


    // 3. Inizializza la logica di navigazione a tab
    // Passa la funzione di inizializzazione della nuova tab
    initializeTabNavigation({
        'shopify-products': initializeShopifyProductsTab // Associa la funzione alla tab ID
    });

    // 4. Ora che tutti i componenti sono stati appesi e sono parte del DOM, recupera i riferimenti agli elementi UI.
    // Usiamo querySelector sul *contenitore padre specifico* per maggiore robustezza.
    const dropArea = fileUploaderSection.querySelector('#drop-area');
    const fileInput = fileUploaderSection.querySelector('#fileInput');
    const selectFileBtn = fileUploaderSection.querySelector('#selectFileBtn');
    const uploaderStatusDiv = fileUploaderSection.querySelector('#uploader-status');
    const progressBarContainer = fileUploaderSection.querySelector('#progress-container');
    const progressBar = fileUploaderSection.querySelector('#progress-bar');
    const progressText = fileUploaderSection.querySelector('#progress-text');
    const fileNameSpan = fileUploaderSection.querySelector('#file-name');

    // 5. Verifica che tutti gli elementi critici per l'uploader siano stati trovati.
    if (dropArea && fileInput && selectFileBtn && uploaderStatusDiv && progressBarContainer && progressBar && progressText && fileNameSpan) {
        console.log("Tutti gli elementi UI dell'uploader sono stati trovati. Inizializzo l'uploader.");
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
    } else {
        console.error("ERRORE FATALE: Impossibile trovare uno o più elementi UI dell'uploader dopo l'append del componente. Verificare ID e struttura di 'file-uploader.html'.", {
            dropArea, fileInput, selectFileBtn, uploaderStatusDiv, progressBarContainer, progressBar, progressText, fileNameSpan
        });
    }
});