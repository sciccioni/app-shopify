// assets/js/ui.js - Gestione generale dell'interfaccia utente (loading, modals, tabs, notifiche)

/**
 * Carica un componente HTML da un file template e lo inietta in un elemento target.
 * @param {string} componentName - Il nome del file del componente (es. 'file-uploader').
 * @param {string} targetElementId - L'ID dell'elemento dove iniettare il componente.
 * @returns {Promise<boolean>} Vero se caricato con successo, falso altrimenti.
 */
export async function loadComponent(componentName, targetElementId) {
    try {
        const response = await fetch(`components/${componentName}.html`);
        if (!response.ok) {
            throw new Error(`Impossibile caricare il componente: ${componentName}.html status: ${response.status}`);
        }
        const text = await response.text();
        const template = document.createElement('template');
        template.innerHTML = text;
        const target = document.getElementById(targetElementId);
        if (target) {
            target.appendChild(template.content.cloneNode(true));
            return true;
        }
        console.error(`Elemento target con ID '${targetElementId}' non trovato per il componente '${componentName}'.`);
        return false;
    } catch (error) {
        console.error(`Errore nel caricamento del componente ${componentName}:`, error);
        return false;
    }
}

/**
 * Inizializza la navigazione a tab dell'applicazione.
 */
export function initializeTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    if (tabButtons.length === 0 || tabContents.length === 0) {
        console.warn("Elementi per la navigazione a tab non trovati. La navigazione potrebbe non funzionare.");
        return;
    }

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabContents.forEach(content => {
                if (content.id === `${targetTab}-tab`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });
}

/**
 * Mostra un messaggio di stato nell'uploader.
 * Ora cerca specificamente l'ID 'uploader-status' presente nel template.
 * @param {string} message - Il messaggio da visualizzare.
 * @param {boolean} isError - Vero se è un messaggio di errore, falso altrimenti.
 */
export function showUploaderStatus(message, isError = false) {
    const uploadStatusDiv = document.getElementById('uploader-status'); // ID aggiornato
    if (uploadStatusDiv) {
        uploadStatusDiv.textContent = message;
        uploadStatusDiv.className = `upload-status ${isError ? 'error' : ''}`;
        uploadStatusDiv.classList.remove('hidden');
        // Nasconde il messaggio dopo un po' se non è un errore permanente
        if (!isError) {
            setTimeout(() => {
                uploadStatusDiv.classList.add('hidden');
            }, 5000);
        }
    } else {
        console.warn('Elemento #uploader-status non trovato per visualizzare lo stato.');
    }
}

/**
 * Aggiorna lo stato della progress bar dell'uploader.
 * @param {number} percentage - Percentuale di avanzamento (0-100).
 * @param {string} [fileName=''] - Nome del file per visualizzazione.
 */
export function updateUploaderProgress(percentage, fileName = '') {
    const progressBarContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const fileNameSpan = document.getElementById('file-name');

    // Controlla che tutti gli elementi necessari siano presenti
    if (progressBarContainer && progressBar && progressText && fileNameSpan) {
        if (percentage === 0) { // Nasconde all'inizio o al reset
            progressBarContainer.classList.add('hidden');
            progressBar.style.width = '0%';
            progressText.textContent = '0%';
            fileNameSpan.textContent = '';
        } else if (percentage === 100) { // Nasconde alla fine
            progressBar.style.width = '100%';
            progressText.textContent = '100%';
            setTimeout(() => progressBarContainer.classList.add('hidden'), 500); // Lascia vedere 100% un attimo
        } else { // Mostra e aggiorna durante il progresso
            progressBarContainer.classList.remove('hidden');
            progressBar.style.width = `${percentage}%`;
            progressText.textContent = `${percentage}%`;
            if (fileName) fileNameSpan.textContent = `(${fileName})`;
        }
    } else {
        console.warn('Elementi della progress bar non trovati per aggiornare il progresso.');
    }
}

/**
 * Mostra o nasconde un spinner di caricamento globale.
 * @param {boolean} show - Vero per mostrare, falso per nascondere.
 * @param {string} [targetElementId='app-container'] - L'ID dell'elemento a cui aggiungere lo spinner.
 */
export function toggleLoader(show, targetElementId = 'app-container') {
    const target = document.getElementById(targetElementId);
    if (!target) {
        console.warn(`Target element '${targetElementId}' for loader not found.`);
        return;
    }

    let loader = document.getElementById('app-loader');
    if (show) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'app-loader';
            loader.className = 'modal-overlay'; // Usa lo stesso stile overlay delle modal
            loader.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 8px; text-align: center; display: flex; flex-direction: column; align-items: center;">
                    <div class="spinner" style="width: 50px; height: 50px;"></div>
                    <p style="margin-top: 15px; font-weight: bold; color: var(--primary-color-dark);">Caricamento...</p>
                </div>
            `;
            document.body.appendChild(loader); // Aggiungi al body per essere globale
        }
        loader.classList.remove('hidden');
    } else {
        if (loader) {
            loader.classList.add('hidden');
        }
    }
}

/**
 * Mostra una modal.
 * @param {string} modalId - L'ID dell'elemento overlay della modal.
 */
export function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        // Aggiungi un listener per chiudere la modal cliccando sull'overlay
        modal.addEventListener('click', (e) => {
            if (e.target.id === modalId) { // Se il click è sull'overlay stesso
                hideModal(modalId);
            }
        });
    }
}

/**
 * Nasconde una modal.
 * @param {string} modalId - L'ID dell'elemento overlay della modal.
 */
export function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
    }
}