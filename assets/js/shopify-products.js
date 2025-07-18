// assets/js/shopify-products.js - NUOVO E COMPLETO

import { toggleLoader, showUploaderStatus } from './ui.js'; // showUploaderStatus sarà riutilizzato per messaggi di stato

/**
 * Funzione per inizializzare la logica della tab "Prodotti Shopify".
 * Sarà chiamata quando la tab viene selezionata.
 */
export async function initializeShopifyProductsTab() {
    console.log("Inizializzazione tab Prodotti Shopify...");

    const searchInput = document.getElementById('shopifyProductSearch');
    const refreshButton = document.getElementById('refreshShopifyProducts');
    const tablePlaceholder = document.getElementById('shopifyProductsTablePlaceholder');
    const statusDiv = document.getElementById('shopifyProductsStatus');

    if (!searchInput || !refreshButton || !tablePlaceholder || !statusDiv) {
        console.error("Elementi UI per la tab Prodotti Shopify non trovati.");
        return;
    }

    // Aggiungi listener per la ricerca
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            renderShopifyProductsTable(window.allShopifyProducts || []); // Filtra sui dati già caricati
        }, 500); // Debounce di 500ms
    });

    // Aggiungi listener per il bottone di refresh
    refreshButton.addEventListener('click', () => {
        loadAndRenderShopifyProducts(true); // Forza il refresh
    });

    // Carica i prodotti al primo caricamento della tab
    if (!window.allShopifyProducts) { // Carica solo se non sono già stati caricati
        await loadAndRenderShopifyProducts();
    } else {
        renderShopifyProductsTable(window.allShopifyProducts); // Renderizza con i dati già presenti
    }
}

/**
 * Carica i prodotti da Shopify e li renderizza nella tabella.
 * @param {boolean} forceRefresh - Forza il recupero dei dati da Shopify anche se già presenti in cache.
 */
async function loadAndRenderShopifyProducts(forceRefresh = false) {
    const tablePlaceholder = document.getElementById('shopifyProductsTablePlaceholder');
    const statusDiv = document.getElementById('shopifyProductsStatus');

    tablePlaceholder.innerHTML = '<p>Caricamento prodotti Shopify...</p>'; // Messaggio di caricamento
    showUploaderStatus(statusDiv, '', false); // Pulisci status

    toggleLoader(true); // Mostra loader globale
    try {
        let shopifyProducts;
        if (window.allShopifyProducts && !forceRefresh) {
            shopifyProducts = window.allShopifyProducts; // Usa dati in cache
            console.log("Utilizzando prodotti Shopify dalla cache.");
        } else {
            console.log("Recupero prodotti Shopify da API...");
            // Chiama la Netlify Function per ottenere TUTTI i prodotti
            const response = await fetch('/.netlify/functions/shopify-api?all=true', { method: 'GET' });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Errore durante il recupero dei prodotti Shopify.');
            }
            const data = await response.json();
            shopifyProducts = data.shopifyProducts;
            window.allShopifyProducts = shopifyProducts; // Cache dei prodotti
            console.log(`Recuperati ${shopifyProducts.length} prodotti Shopify.`);
            showUploaderStatus(statusDiv, `Prodotti Shopify caricati: ${shopifyProducts.length}`, false);
        }

        renderShopifyProductsTable(shopifyProducts); // Renderizza la tabella
    } catch (error) {
        console.error('Errore nel caricamento dei prodotti Shopify:', error);
        tablePlaceholder.innerHTML = '<p class="text-danger">Errore durante il caricamento dei prodotti Shopify.</p>';
        showUploaderStatus(statusDiv, `Errore: ${error.message}`, true);
    } finally {
        toggleLoader(false); // Nasconde loader globale
    }
}

/**
 * Renderizza la tabella dei prodotti Shopify, applicando filtri di ricerca.
 * @param {Array<object>} products - Array di oggetti prodotto Shopify.
 */
function renderShopifyProductsTable(products) {
    const tablePlaceholder = document.getElementById('shopifyProductsTablePlaceholder');
    const searchInput = document.getElementById('shopifyProductSearch');
    if (!tablePlaceholder || !searchInput) return;

    const searchTerm = searchInput.value.toLowerCase();

    const filteredProducts = products.filter(p => {
        return (
            String(p.minsan || '').toLowerCase().includes(searchTerm) ||
            String(p.title || '').toLowerCase().includes(searchTerm) ||
            String(p.variants?.[0]?.sku || '').toLowerCase().includes(searchTerm) ||
            String(p.variants?.[0]?.barcode || '').toLowerCase().includes(searchTerm)
        );
    });

    if (filteredProducts.length === 0) {
        tablePlaceholder.innerHTML = '<p>Nessun prodotto trovato con i criteri di ricerca.</p>';
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

        let statusClass = 'status-indicator';
        let statusText = 'Attivo';
        if (inventoryQuantity <= 0) {
            statusClass += ' shopify-only'; // Riutilizziamo la classe per "esaurito"
            statusText = 'Esaurito';
        }

        html += `
            <tr>
                <td>${minsan} <br><small>${barcode !== '-' ? 'EAN: ' + barcode : ''}</small></td>
                <td>${product.title}</td>
                <td>€ ${price}</td>
                <td>${inventoryQuantity}</td>
                <td>${product.Scadenza || '-'}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
                <td>
                    <button class="btn secondary btn-view-details" data-minsan="${minsan}">Dettagli</button>
                    <button class="btn primary btn-edit-shopify" data-minsan="${minsan}">Modifica</button>
                </td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    tablePlaceholder.innerHTML = html;

    // Aggiungi listener per i bottoni "Dettagli" e "Modifica"
    // Usiamo la delegazione degli eventi sul placeholder per elementi generati dinamicamente
    tablePlaceholder.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-view-details')) {
            const minsan = e.target.dataset.minsan;
            console.log('Dettagli per prodotto Shopify Minsan:', minsan);
            // Qui potresti aprire una modal con tutti i dettagli del prodotto Shopify
            // Reutilizzare showProductPreviewModal con un tipo specifico per Shopify solo visualizzazione.
            const productDetails = window.allShopifyProducts.find(p => String(p.minsan).trim() === minsan);
            if (productDetails) {
                 // showProductPreviewModal(minsan, null, productDetails, 'shopify-details'); // Creare un tipo 'shopify-details'
                 showUploaderStatus(document.getElementById('uploader-status'), `Dettagli per ${minsan} (da implementare)`, 'info');
            }
        } else if (e.target.classList.contains('btn-edit-shopify')) {
            const minsan = e.target.dataset.minsan;
            console.log('Modifica prodotto Shopify Minsan:', minsan);
            // Qui potresti reindirizzare a una pagina di modifica o aprire una modal di modifica
            showUploaderStatus(document.getElementById('uploader-status'), `Modifica per ${minsan} (da implementare)`, 'info');
        }
    });
}