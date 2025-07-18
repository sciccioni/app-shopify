// assets/js/shopify-products.js - AGGIORNATO E COMPLETO (Paginazione e UX)

import { toggleLoader, showUploaderStatus } from './ui.js';

// Variabili di stato per la paginazione
let currentPage = 1;
let totalShopifyProducts = 0; // Se Shopify API fornisse un conto totale, altrimenti stima
let currentPageInfo = null; // Il page_info della pagina corrente
let nextPageInfo = null;    // Il page_info per la prossima pagina
let prevPageInfo = null;    // Il page_info per la pagina precedente
const PRODUCTS_PER_PAGE = 20; // Numero di prodotti per pagina (deve corrispondere al limit del backend)


/**
 * Funzione per inizializzare la logica della tab "Prodotti Shopify".
 * Sarà chiamata quando la tab viene selezionata.
 */
export async function initializeShopifyProductsTab() {
    console.log("Inizializzazione tab Prodotti Shopify...");

    const searchInput = document.getElementById('shopifyProductSearch');
    const refreshButton = document.getElementById('refreshShopifyProducts');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const tablePlaceholder = document.getElementById('shopifyProductsTablePlaceholder');
    const statusDiv = document.getElementById('shopifyProductsStatus');
    const pageInfoSpan = document.getElementById('pageInfo');

    // Assicurati che gli elementi UI critici esistano
    if (!searchInput || !refreshButton || !prevPageBtn || !nextPageBtn || !tablePlaceholder || !statusDiv || !pageInfoSpan) {
        console.error("Elementi UI per la tab Prodotti Shopify non trovati. Assicurati che 'shopify-products-table.html' sia caricato correttamente e che tutti gli ID siano presenti.");
        return;
    }

    // Aggiungi listener per la ricerca
    // La ricerca ora avverrà sui dati DELLA PAGINA CORRENTE per non richiedere troppi dati.
    // Per una ricerca su TUTTI i prodotti, si richiederebbe un endpoint API Shopify di ricerca (o database).
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            // Se window.allShopifyProducts ha tutti i prodotti scaricati dalla pagina corrente, filtra.
            // Altrimenti, ricarica la pagina corrente e poi filtra.
            renderShopifyProductsTable(window.currentShopifyPageProducts || []); // Filtra sui dati della pagina corrente
        }, 300); // Debounce per la ricerca
    });

    // Aggiungi listener per il bottone di refresh
    refreshButton.addEventListener('click', () => {
        currentPage = 1; // Resetta alla prima pagina
        currentPageInfo = null; // Resetta il cursore di paginazione
        loadAndRenderShopifyProducts(true); // Forza il refresh
    });

    // Listener per i bottoni di paginazione
    prevPageBtn.addEventListener('click', () => {
        if (prevPageInfo) {
            currentPage--;
            loadAndRenderShopifyProducts(false, prevPageInfo);
        }
    });

    nextPageBtn.addEventListener('click', () => {
        if (nextPageInfo) {
            currentPage++;
            loadAndRenderShopifyProducts(false, nextPageInfo);
        }
    });

    // Carica i prodotti al primo caricamento della tab
    // Ora il caricamento iniziale avviene sempre tramite API per la paginazione
    await loadAndRenderShopifyProducts();
}

/**
 * Carica i prodotti da Shopify e li renderizza nella tabella.
 * @param {boolean} forceRefresh - Forza il recupero dei dati da Shopify anche se già presenti in cache (utile per refresh button).
 * @param {string} [pageInfo=null] - Il parametro page_info per l'API Shopify (cursore di paginazione).
 */
async function loadAndRenderShopifyProducts(forceRefresh = false, pageInfo = null) {
    const tablePlaceholder = document.getElementById('shopifyProductsTablePlaceholder');
    const statusDiv = document.getElementById('shopifyProductsStatus');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfoSpan = document.getElementById('pageInfo');
    const shopifyProductsLoader = document.getElementById('shopifyProductsLoader'); // Il loader specifico della tab

    if (!tablePlaceholder || !statusDiv || !prevPageBtn || !nextPageBtn || !pageInfoSpan || !shopifyProductsLoader) {
        console.error("Elementi UI per la tab Prodotti Shopify mancanti during loadAndRender.");
        return;
    }

    // Mostra il loader e nascondi la tabella temporaneamente
    tablePlaceholder.innerHTML = ''; // Pulisce il contenuto precedente
    shopifyProductsLoader.classList.remove('hidden');
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    pageInfoSpan.textContent = 'Caricamento...';
    showUploaderStatus(statusDiv, '', false); // Pulisci status

    try {
        console.log(`Recupero prodotti Shopify dalla pagina: ${pageInfo || 'prima pagina'}`);
        // Chiama la Netlify Function per ottenere i prodotti della pagina corrente
        const response = await fetch(`/.netlify/functions/get-all-shopify-products?limit=${PRODUCTS_PER_PAGE}&page_info=${pageInfo || ''}`, { method: 'GET' });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Errore durante il recupero dei prodotti Shopify dalla pagina.');
        }
        const data = await response.json();

        // Aggiorna lo stato di paginazione globale
        window.currentShopifyPageProducts = data.shopifyProducts; // Salva solo i prodotti della pagina corrente
        nextPageInfo = data.nextPageInfo;
        prevPageInfo = data.prevPageInfo;
        currentPageInfo = pageInfo; // Aggiorna il cursore della pagina corrente

        // Renderizza la tabella con i prodotti della pagina corrente
        renderShopifyProductsTable(window.currentShopifyPageProducts);

        // Aggiorna i controlli di paginazione
        prevPageBtn.disabled = !prevPageInfo;
        nextPageBtn.disabled = !nextPageInfo;
        pageInfoSpan.textContent = `Pagina ${currentPage} (Prodotti: ${data.shopifyProducts.length})`; // Non abbiamo il totale, quindi mostriamo solo la pagina corrente e i prodotti caricati

        showUploaderStatus(statusDiv, `Prodotti caricati per questa pagina: ${data.shopifyProducts.length}`, false);

    } catch (error) {
        console.error('Errore nel caricamento dei prodotti Shopify:', error);
        tablePlaceholder.innerHTML = '<p class="text-danger">Errore durante il caricamento dei prodotti Shopify. Prova ad aggiornare.</p>';
        showUploaderStatus(statusDiv, `Errore: ${error.message}`, true);
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
        pageInfoSpan.textContent = 'Errore';
    } finally {
        shopifyProductsLoader.classList.add('hidden'); // Nasconde il loader della tabella
    }
}

/**
 * Renderizza la tabella dei prodotti Shopify, applicando filtri di ricerca.
 * @param {Array<object>} products - Array di oggetti prodotto Shopify (questa dovrebbe essere la singola pagina di prodotti).
 */
function renderShopifyProductsTable(products) {
    const tablePlaceholder = document.getElementById('shopifyProductsTablePlaceholder');
    const searchInput = document.getElementById('shopifyProductSearch');
    if (!tablePlaceholder || !searchInput) return;

    const searchTerm = searchInput.value.toLowerCase();

    // Filtra i prodotti solo sulla pagina attualmente caricata
    const filteredProducts = products.filter(p => {
        return (
            String(p.minsan || '').toLowerCase().includes(searchTerm) ||
            String(p.title || '').toLowerCase().includes(searchTerm) ||
            String(p.variants?.[0]?.sku || '').toLowerCase().includes(searchTerm) ||
            String(p.variants?.[0]?.barcode || '').toLowerCase().includes(searchTerm)
        );
    });

    if (filteredProducts.length === 0 && searchTerm === '') {
        tablePlaceholder.innerHTML = '<p>Nessun prodotto trovato su Shopify per questa pagina.</p>';
        return;
    } else if (filteredProducts.length === 0 && searchTerm !== '') {
        tablePlaceholder.innerHTML = '<p>Nessun prodotto corrisponde alla ricerca su questa pagina.</p>';
        return;
    }


    let html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Minsan / SKU</th>
                    <th>Descrizione</th>
                    <th>Prezzo</th>
                    <th>Giacenza</th>
                    <th>Scadenza</th>
                    <th>Stato</th>
                    <th>Azioni</th>
                </tr>
            </thead>
            <tbody>
    `;

    filteredProducts.forEach(product => {
        const variant = product.variants?.[0] || {};
        const inventoryQuantity = variant.inventory_quantity ?? 0;
        const price = parseFloat(variant.price ?? 0).toFixed(2);
        const minsan = product.minsan || variant.sku || product.id; // Il minsan normalizzato
        const barcode = variant.barcode || '-';