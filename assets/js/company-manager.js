// assets/js/company-manager.js - NUOVO E COMPLETO

import { showUploaderStatus } from './ui.js'; // Per mostrare messaggi di stato

const COMPANIES_STORAGE_KEY = 'pharmacy_app_companies'; // Chiave per localStorage

let companies = []; // Array per memorizzare le ditte

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

    // Carica le ditte dal localStorage all'avvio
    loadCompanies();
    renderCompaniesTable();

    // Listener per la sottomissione del form
    companyForm.addEventListener('submit', (e) => {
        e.preventDefault(); // Previeni il ricaricamento della pagina
        saveCompany();
    });

    // Listener per il bottone "Annulla Modifica"
    cancelEditBtn.addEventListener('click', resetForm);

    // Listener per il bottone "Ricalcola Tutti i Prezzi"
    recalculateAllPricesBtn.addEventListener('click', () => {
        showUploaderStatus(companyListStatus, "Funzionalità 'Ricalcola Tutti i Prezzi' da implementare.", 'info');
        console.log("Ricalcola Tutti i Prezzi cliccato.");
        // Qui verrà la logica per ricalcolare i prezzi di tutti i prodotti Shopify
        // in base ai markup delle ditte, e poi aggiornare Shopify.
    });

    // Listener delegato per i bottoni Modifica ed Elimina nella tabella
    companiesTableBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-edit-company')) {
            const idToEdit = e.target.dataset.id;
            editCompany(idToEdit);
        } else if (e.target.classList.contains('btn-delete-company')) {
            const idToDelete = e.target.dataset.id;
            deleteCompany(idToDelete);
        }
    });

    /**
     * Carica le ditte dal localStorage.
     */
    function loadCompanies() {
        try {
            const storedCompanies = localStorage.getItem(COMPANIES_STORAGE_KEY);
            if (storedCompanies) {
                companies = JSON.parse(storedCompanies);
                console.log("Ditte caricate da localStorage:", companies);
            } else {
                companies = [];
                console.log("Nessuna ditta trovata in localStorage.");
            }
        } catch (error) {
            console.error("Errore nel caricamento delle ditte da localStorage:", error);
            companies = []; // Resetta in caso di errore di parsing
            showUploaderStatus(companyListStatus, "Errore nel caricamento delle ditte salvate.", true);
        }
    }

    /**
     * Salva le ditte nel localStorage.
     */
    function saveCompanies() {
        try {
            localStorage.setItem(COMPANIES_STORAGE_KEY, JSON.stringify(companies));
            console.log("Ditte salvate in localStorage.");
        } catch (error) {
            console.error("Errore nel salvataggio delle ditte in localStorage:", error);
            showUploaderStatus(companyListStatus, "Errore nel salvataggio delle ditte.", true);
        }
    }

    /**
     * Aggiunge una nuova ditta o aggiorna una esistente.
     */
    function saveCompany() {
        const name = companyNameInput.value.trim();
        const markup = parseFloat(companyMarkupInput.value);
        const id = companyIdInput.value;

        if (!name || isNaN(markup)) {
            showUploaderStatus(companyListStatus, "Per favore, inserisci un nome ditta e un markup validi.", true);
            return;
        }

        if (id) {
            // Modifica ditta esistente
            const index = companies.findIndex(c => c.id === id);
            if (index !== -1) {
                companies[index] = { ...companies[index], name, markup };
                showUploaderStatus(companyListStatus, `Ditta "${name}" aggiornata con successo!`, false);
            }
        } else {
            // Aggiungi nuova ditta
            // Controlla se esiste già una ditta con lo stesso nome (case-insensitive)
            if (companies.some(c => c.name.toLowerCase() === name.toLowerCase())) {
                showUploaderStatus(companyListStatus, `Una ditta con il nome "${name}" esiste già.`, true);
                return;
            }
            const newId = Date.now().toString(); // ID semplice basato sul timestamp
            companies.push({ id: newId, name, markup });
            showUploaderStatus(companyListStatus, `Ditta "${name}" aggiunta con successo!`, false);
        }

        saveCompanies();
        renderCompaniesTable();
        resetForm();
    }

    /**
     * Prepopola il form per la modifica di una ditta.
     * @param {string} id - L'ID della ditta da modificare.
     */
    function editCompany(id) {
        const companyToEdit = companies.find(c => c.id === id);
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
     * Elimina una ditta.
     * @param {string} id - L'ID della ditta da eliminare.
     */
    function deleteCompany(id) {
        const companyToDelete = companies.find(c => c.id === id);
        if (companyToDelete && confirm(`Sei sicuro di voler eliminare la ditta "${companyToDelete.name}"?`)) {
            companies = companies.filter(c => c.id !== id);
            saveCompanies();
            renderCompaniesTable();
            showUploaderStatus(companyListStatus, `Ditta "${companyToDelete.name}" eliminata con successo.`, false);
            resetForm(); // Resetta il form se stavi modificando la ditta eliminata
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