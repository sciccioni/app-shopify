// assets/js/company-manager.js - AGGIORNATO E COMPLETO (Integrazione Supabase API)

import { showUploaderStatus, toggleLoader } from './ui.js';

let companies = []; // Array per memorizzare le ditte caricate dal DB

/**
 * Inizializza la logica per la tab "Gestione Ditte".
 * Carica le ditte esistenti, configura i listener per il form e i bottoni.
 */
export function initializeCompanyManagerTab() {
    console.log("Inizializzazione tab 'Gestione Ditte'...");

    // Riferimenti agli elementi UI
    const companyForm = document.getElementById('companyForm');
    const companyNameInput = document.getElementById('companyName');
    const companyMarkupInput = document.getElementById('companyMarkup');
    const companyIdInput = document.getElementById('companyId');
    const saveCompanyBtn = document.getElementById('saveCompanyBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const companiesTableBody = document.getElementById('companiesTableBody');
    const companyListStatus = document.getElementById('companyListStatus');
    const recalculateAllPricesBtn = document.getElementById('recalculateAllPricesBtn');

    // Assicurati che tutti gli elementi UI necessari siano presenti
    if (!companyForm || !companyNameInput || !companyMarkupInput || !companyIdInput ||
        !saveCompanyBtn || !cancelEditBtn || !companiesTableBody || !companyListStatus ||
        !recalculateAllPricesBtn) {
        console.error("Uno o più elementi UI per la gestione ditte non trovati. Assicurati che 'company-manager-tab.html' sia caricato correttamente.");
        return;
    }

    // Carica le ditte dal database all'avvio della tab
    loadCompanies();

    // Listener per la sottomissione del form
    companyForm.addEventListener('submit', async (e) => { // Reso async
        e.preventDefault();
        await saveCompany(); // Attendi il salvataggio
    });

    // Listener per il bottone "Annulla Modifica"
    cancelEditBtn.addEventListener('click', resetForm);

    // Listener per il bottone "Ricalcola Tutti i Prezzi"
    recalculateAllPricesBtn.addEventListener('click', () => {
        showUploaderStatus(companyListStatus, "Funzionalità 'Ricalcola Tutti i Prezzi' da implementare (con integrazione Shopify).", 'info');
        console.log("Ricalcola Tutti i Prezzi cliccato.");
        // Qui verrà la logica per ricalcolare i prezzi di tutti i prodotti Shopify
        // in base ai markup delle ditte, e poi aggiornare Shopify.
    });

    // Listener delegato per i bottoni Modifica ed Elimina nella tabella
    companiesTableBody.addEventListener('click', async (e) => { // Reso async
        if (e.target.classList.contains('btn-edit-company')) {
            const idToEdit = e.target.dataset.id;
            editCompany(idToEdit); // Modifica locale, poi salva via API
        } else if (e.target.classList.contains('btn-delete-company')) {
            const idToDelete = e.target.dataset.id;
            await deleteCompany(idToDelete); // Attendi l'eliminazione
        }
    });

    /**
     * Carica le ditte dal database tramite API.
     */
    async function loadCompanies() {
        toggleLoader(true); // Mostra loader
        showUploaderStatus(companyListStatus, "Caricamento ditte...", false);
        try {
            const response = await fetch('/.netlify/functions/company-api', { method: 'GET' });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Errore durante il recupero delle ditte.');
            }
            const data = await response.json();
            companies = data.companies; // Aggiorna l'array di ditte
            console.log("Ditte caricate da Supabase:", companies);
            renderCompaniesTable(); // Renderizza la tabella
            showUploaderStatus(companyListStatus, `Ditte caricate: ${companies.length}`, false);
        } catch (error) {
            console.error("Errore nel caricamento delle ditte:", error);
            companies = []; // Resetta in caso di errore
            renderCompaniesTable(); // Renderizza tabella vuota
            showUploaderStatus(companyListStatus, `Errore nel caricamento delle ditte: ${error.message}`, true);
        } finally {
            toggleLoader(false); // Nasconde loader
        }
    }

    /**
     * Aggiunge una nuova ditta o aggiorna una esistente tramite API.
     */
    async function saveCompany() {
        const name = companyNameInput.value.trim();
        const markup = parseFloat(companyMarkupInput.value);
        const id = companyIdInput.value; // Sarà vuoto per le nuove ditte

        if (!name || isNaN(markup)) {
            showUploaderStatus(companyListStatus, "Per favore, inserisci un nome ditta e un markup validi.", true);
            return;
        }

        toggleLoader(true);
        try {
            let response;
            let method;
            let url;
            let message;

            if (id) {
                // Modifica ditta esistente
                method = 'PUT';
                url = `/.netlify/functions/company-api/${id}`;
                message = 'Ditta aggiornata con successo!';
            } else {
                // Aggiungi nuova ditta
                // Controlla se esiste già una ditta con lo stesso nome (case-insensitive)
                if (companies.some(c => c.name.toLowerCase() === name.toLowerCase())) {
                    showUploaderStatus(companyListStatus, `Una ditta con il nome "${name}" esiste già.`, true);
                    toggleLoader(false);
                    return;
                }
                method = 'POST';
                url = '/.netlify/functions/company-api';
                message = 'Ditta aggiunta con successo!';
            }

            response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, markup })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `Errore durante il salvataggio della ditta: ${response.statusText}`);
            }

            showUploaderStatus(companyListStatus, message, false);
            await loadCompanies(); // Ricarica le ditte per aggiornare la tabella
            resetForm();
        } catch (error) {
            console.error("Errore nel salvataggio della ditta:", error);
            showUploaderStatus(companyListStatus, `Errore nel salvataggio della ditta: ${error.message}`, true);
        } finally {
            toggleLoader(false);
        }
    }

    /**
     * Prepopola il form per la modifica di una ditta.
     * @param {string} id - L'ID della ditta da modificare (stringa UUID).
     */
    function editCompany(id) {
        // ID dal database è probabilmente un intero o UUID.
        // Assicurati che il confronto sia corretto (stringa === stringa o numero === numero).
        const companyToEdit = companies.find(c => String(c.id) === String(id)); 
        if (companyToEdit) {
            companyNameInput.value = companyToEdit.name;
            companyMarkupInput.value = companyToEdit.markup;
            companyIdInput.value = companyToEdit.id; // Imposta l'ID per la modifica
            saveCompanyBtn.textContent = 'Aggiorna Ditta';
            cancelEditBtn.style.display = 'inline-block';
            showUploaderStatus(companyListStatus, `Modifica ditta: "${companyToEdit.name}"`, false);
        } else {
            showUploaderStatus(companyListStatus, "Ditta non trovata per la modifica.", true);
        }
    }

    /**
     * Elimina una ditta tramite API.
     * @param {string} id - L'ID della ditta da eliminare (stringa UUID).
     */
    async function deleteCompany(id) {
        const companyToDelete = companies.find(c => String(c.id) === String(id));
        if (companyToDelete && confirm(`Sei sicuro di voler eliminare la ditta "${companyToDelete.name}"?`)) {
            toggleLoader(true);
            try {
                const response = await fetch(`/.netlify/functions/company-api/${id}`, { method: 'DELETE' });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || `Errore durante l'eliminazione della ditta: ${response.statusText}`);
                }
                showUploaderStatus(companyListStatus, `Ditta "${companyToDelete.name}" eliminata con successo.`, false);
                await loadCompanies(); // Ricarica le ditte
                resetForm(); // Resetta il form se stavi modificando la ditta eliminata
            } catch (error) {
                console.error("Errore nell'eliminazione della ditta:", error);
                showUploaderStatus(companyListStatus, `Errore nell'eliminazione della ditta: ${error.message}`, true);
            } finally {
                toggleLoader(false);
            }
        }
    }

    /**
     * Resetta il form e i bottoni.
     */
    function resetForm() {
        companyForm.reset();
        companyIdInput.value = ''; // Pulisci l'ID
        saveCompanyBtn.textContent = 'Salva Ditta';
        cancelEditBtn.style.display = 'none';
        showUploaderStatus(companyListStatus, '', false); // Pulisci lo stato
    }

    /**
     * Renderizza la tabella delle ditte.
     */
    function renderCompaniesTable() {
        if (companies.length === 0) {
            companiesTableBody.innerHTML = '<tr><td colspan="3">Nessuna ditta registrata.</td></tr>';
            return;
        }

        companiesTableBody.innerHTML = companies.map(company => `
            <tr>
                <td>${company.name}</td>
                <td>${company.markup.toFixed(2)}%</td>
                <td>
                    <button class="btn secondary btn-edit-company" data-id="${company.id}">Modifica</button>
                    <button class="btn danger btn-delete-company" data-id="${company.id}">Elimina</button>
                </td>
            </tr>
        `).join('');
    }
}