// assets/js/main.js - AGGIORNATO

import { loadComponent, initializeTabNavigation } from './ui.js';
import { initializeFileUploader } from './uploader.js';
import { renderComparisonTable } from './comparison.js';

// Variabili globali per i dati, usate tra i moduli
window.currentFileProducts = [];
window.currentShopifyProducts = [];

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Carica e appendi direttamente i componenti UI nelle rispettive sezioni.
    // loadComponent ora restituisce l'elemento root clonato, non lo appende.

    const fileUploaderSection = document.getElementById('file-uploader-section');
    const comparisonTableSection = document.getElementById('comparison-table-section');
    const modalContainer = document.getElementById('modal-container');

    // Carica il componente Uploader
    const uploaderRoot = await loadComponent('file-uploader');
    if (uploaderRoot && fileUploaderSection) {
        fileUploaderSection.appendChild(uploaderRoot);
    } else {
        console.error("ERRORE CRITICO: Impossibile caricare o appendere il componente 'file-uploader'.");
        return; // Fermiamo l'esecuzione se il componente chiave non è disponibile
    }

    // Carica il componente Comparison Table
    const comparisonRoot = await loadComponent('comparison-table');
    if (comparisonRoot && comparisonTableSection) {
        comparisonTableSection.appendChild(comparisonRoot);
    } else {
        console.error("ERRORE CRITICO: Impossibile caricare o appendere il componente 'comparison-table'.");
        // Non è critico come l'uploader, ma è importante per l'UX
    }

    // Carica il componente Preview Modal
    const previewModalRoot = await loadComponent('preview-modal');
    if (previewModalRoot && modalContainer) {
        modalContainer.appendChild(previewModalRoot);
    } else {
        console.error("ERRORE CRITICO: Impossibile caricare o appendere il componente 'preview-modal'.");
    }

    // 2. Inizializza la logica di navigazione a tab
    initializeTabNavigation();

    // 3. Inizializza la logica per l'uploader, passando i riferimenti agli elementi HTML
    // Ora che gli elementi sono certamente nel DOM (appena appesi), possiamo queryarli con fiducia.
    const dropArea = uploaderRoot.querySelector('#drop-area');
    const fileInput = uploaderRoot.querySelector('#fileInput');
    const selectFileBtn = uploaderRoot.querySelector('#selectFileBtn');
    const uploaderStatusDiv = uploaderRoot.querySelector('#uploader-status');
    const progressBarContainer = uploaderRoot.querySelector('#progress-container');
    const progressBar = uploaderRoot.querySelector('#progress-bar');
    const progressText = uploaderRoot.querySelector('#progress-text');
    const fileNameSpan = uploaderRoot.querySelector('#file-name');

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
    } else {
        console.error("ERRORE: Impossibile trovare uno o più elementi UI dell'uploader all'interno del componente caricato dopo l'append. Verificare ID e struttura di 'file-uploader.html'.", {
            dropArea, fileInput, selectFileBtn, uploaderStatusDiv, progressBarContainer, progressBar, progressText, fileNameSpan
        });
    }
});