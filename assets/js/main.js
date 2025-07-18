// assets/js/main.js - Punto di ingresso dell'applicazione
import { loadComponent, initializeTabNavigation } from './ui.js';
import { initializeFileUploader } from './uploader.js';
import { renderComparisonTable } from './comparison.js';

// Variabili globali per i dati, usate tra i moduli (resa globale per accessibilità)
window.currentFileProducts = [];
window.currentShopifyProducts = [];

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Carica i componenti UI nelle rispettive sezioni.
    // L'uso di await è cruciale qui: il codice successivo attenderà che il componente sia nel DOM.
    const uploaderLoaded = await loadComponent('file-uploader', 'file-uploader-section');
    await loadComponent('comparison-table', 'comparison-table-section');
    await loadComponent('preview-modal', 'modal-container'); // Carica la modal globalmente

    // 2. Inizializza la logica di navigazione a tab
    initializeTabNavigation();

    // 3. Inizializza la logica per l'uploader
    if (uploaderLoaded) { // Continua solo se il caricamento dell'uploader è riuscito
        // Ottieni i riferimenti agli elementi HTML dell'uploader *dopo* che sono stati caricati nel DOM.
        // Selezioniamo il contenitore generale dell'uploader e poi i suoi figli.
        const fileUploaderSection = document.getElementById('file-uploader-section');
        const dropArea = fileUploaderSection ? fileUploaderSection.querySelector('#drop-area') : null;
        const fileInput = fileUploaderSection ? fileUploaderSection.querySelector('#fileInput') : null;
        const selectFileBtn = fileUploaderSection ? fileUploaderSection.querySelector('#selectFileBtn') : null;

        if (dropArea && fileInput && selectFileBtn) {
            initializeFileUploader({
                dropArea: dropArea,
                fileInput: fileInput,
                selectFileBtn: selectFileBtn,
                onUploadSuccess: async (processedProducts, shopifyProducts) => {
                    window.currentFileProducts = processedProducts;
                    window.currentShopifyProducts = shopifyProducts;
                    renderComparisonTable(processedProducts, shopifyProducts);
                }
            });
        } else {
            console.error("ERRORE: Impossibile trovare uno o più elementi UI dell'uploader dopo il caricamento del componente.");
        }
    } else {
        console.error("ERRORE CRITICO: Il componente 'file-uploader' non è stato caricato correttamente. La funzionalità di upload non sarà disponibile.");
    }
});