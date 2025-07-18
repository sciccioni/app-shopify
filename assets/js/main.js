// assets/js/main.js - Punto di ingresso dell'applicazione
import { loadComponent, initializeTabNavigation } from './ui.js';
import { initializeFileUploader } from './uploader.js';
import { renderComparisonTable } from './comparison.js';

// Variabili globali per i dati, usate tra i moduli (resa globale per accessibilità)
window.currentFileProducts = [];
window.currentShopifyProducts = [];

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Carica i componenti UI nelle rispettive sezioni
    // È fondamentale che questi "await" vengano completati prima di tentare di inizializzare la logica JS
    const uploaderLoaded = await loadComponent('file-uploader', 'file-uploader-section');
    const comparisonLoaded = await loadComponent('comparison-table', 'comparison-table-section');
    const modalLoaded = await loadComponent('preview-modal', 'modal-container'); // Carica la modal globalmente

    // 2. Inizializza la logica di navigazione a tab
    initializeTabNavigation();

    // 3. Inizializza la logica per l'uploader, passando i riferimenti agli elementi HTML
    if (uploaderLoaded) { // Inizializza l'uploader solo se il suo HTML è stato caricato correttamente
        // Ottieni i riferimenti agli elementi HTML DOPO che il componente è stato caricato nel DOM
        const dropArea = document.getElementById('drop-area');
        const fileInput = document.getElementById('fileInput');
        const selectFileBtn = document.getElementById('selectFileBtn');

        initializeFileUploader({ // Passiamo un oggetto con gli elementi e la callback
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
        console.error("ERRORE CRITICO: Il componente file-uploader non è stato caricato. L'upload non funzionerà.");
    }
});