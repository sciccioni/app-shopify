// main.js - Punto di ingresso dell'applicazione
import { loadComponent, initializeTabNavigation } from './ui.js';
import { initializeFileUploader } from './uploader.js';
import { renderComparisonTable, showProductPreviewModal } from './comparison.js';

// Variabili globali per i dati, usate tra i moduli
window.currentFileProducts = [];
window.currentShopifyProducts = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Carica i componenti UI nelle rispettive sezioni
    await loadComponent('file-uploader', 'file-uploader-section');
    await loadComponent('comparison-table', 'comparison-table-section');
    await loadComponent('preview-modal', 'modal-container'); // Carica la modal globalmente

    // Inizializza la logica di navigazione a tab
    initializeTabNavigation();

    // Inizializza la logica per l'uploader, passando la funzione di callback per il rendering della tabella
    initializeFileUploader(async (processedProducts, shopifyProducts) => {
        window.currentFileProducts = processedProducts;
        window.currentShopifyProducts = shopifyProducts;
        renderComparisonTable(processedProducts, shopifyProducts);
    });

    // Inizializza la logica per i bottoni "Anteprima" e "Approva" nella tabella
    // Questi listener devono essere aggiunti DOPO che la tabella è stata renderizzata
    // e saranno gestiti nel modulo comparison.js
});