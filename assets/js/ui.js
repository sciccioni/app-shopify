// assets/js/ui.js - COMPLETO E CORRETTO

/**
 * Carica un componente HTML da un file template.
 * Non lo inietta direttamente nel DOM, ma restituisce un DocumentFragment
 * contenente una copia profonda del contenuto del template.
 * Sarà responsabilità del chiamante (es. main.js) inserire questo frammento nel DOM
 * e recuperare i riferimenti agli elementi desiderati.
 * @param {string} componentName - Il nome del file del componente (es. 'file-uploader').
 * @returns {Promise<DocumentFragment|null>} Il DocumentFragment contenente il componente clonato, o null in caso di errore.
 */
export async function loadComponent(componentName) {
    try {
        const response = await fetch(`components/${componentName}.html`);
        if (!response.ok) {
            console.error(`Errore HTTP durante il caricamento del componente ${componentName}.html: ${response.status} ${response.statusText}`);
            return null;
        }
        const text = await response.text();
        const parser = new DOMParser();
        // Parsa il testo HTML come un documento completo.
        // Questo è il modo più robusto per gestire frammenti HTML potenzialmente complessi.
        const doc = parser.parseFromString(text, 'text/html');

        // Crea un DocumentFragment e sposta tutti i nodi figli dal <body> del documento parso a esso.
        // Questo gestisce correttamente anche il caso in cui il componente non abbia un singolo elemento radice,
        // o abbia commenti, spazi bianchi, ecc., garantendo che solo il markup visibile venga processato.
        const fragment = document.createDocumentFragment();
        while (doc.body.firstChild) {
            fragment.appendChild(doc.body.firstChild);
        }
        return fragment;
    } catch (error) {
        console.error(`Errore nel caricamento del componente ${componentName}:`, error);
        return null;
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
 * Mostra un messaggio di stato in un div specifico dell'uploader.
 * @param {HTMLElement} statusDiv - L'elemento div dove mostrare lo stato (passato come parametro).
 * @param {string} message - Il messaggio da visualizzare.
 * @param {boolean} isError - Vero se è un messaggio di errore, falso altrimenti.
 */
export function showUploaderStatus(statusDiv, message, isError = false) {
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.className = `upload-status ${isError ? 'error' : ''}`;
        statusDiv.classList.remove('hidden');
        if (!isError) {
            setTimeout(() => {
                statusDiv.classList.add('hidden');
            }, 5000);
        }
    } else {
        console.warn('showUploaderStatus: Elemento statusDiv non fornito o non trovato per visualizzare lo stato. Messaggio: ' + message);
    }
}

/**
 * Aggiorna lo stato della progress bar dell'uploader.
 * @param {HTMLElement} progressBarContainer - Contenitore della progress bar.
 * @param {HTMLElement} progressBar - La barra di progresso.
 * @param {HTMLElement} progressText - Testo della percentuale.
 * @param {HTMLElement} fileNameSpan - Span per il nome del file.
 * @param {number} percentage - Percentuale di avanzamento (0-100).
 * @param {string} [fileName=''] - Nome del file per visualizzazione.
 */
export function updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, percentage, fileName = '') {
    if (progressBarContainer && progressBar && progressText && fileNameSpan) {
        if (percentage === 0) {
             progressBarContainer.classList.add('hidden');
             progressBar.style.width = '0%';
             progressText.textContent = '0%';
             fileNameSpan.textContent = '';
        } else if (percentage === 100) {
            progressBar.style.width = '100%';
            progressText.textContent = '100%';
            setTimeout(() => progressBarContainer.classList.add('hidden'), 500);
        } else {
            progressBarContainer.classList.remove('hidden');
            progressBar.style.width = `${percentage}%`;
            progressText.textContent = `${percentage}%`;
            if (fileName) fileNameSpan.textContent = `(${fileName})`;
        }
    } else {
        console.warn('updateUploaderProgress: Uno o più elementi della progress bar non forniti o non trovati.');
    }
}

/**
 * Mostra o nasconde un spinner di caricamento globale.
 * @param {boolean} show - Vero per mostrare, falso per nascondere.
 */
export function toggleLoader(show) {
    let loader = document.getElementById('app-loader');
    if (show) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'app-loader';
            loader.className = 'modal-overlay';
            loader.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 8px; text-align: center; display: flex; flex-direction: column; align-items: center;">
                    <div class="spinner" style="width: 50px; height: 50px;"></div>
                    <p style="margin-top: 15px; font-weight: bold; color: var(--primary-color-dark);">Caricamento...</p>
                </div>
            `;
            document.body.appendChild(loader);
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
        const clickHandler = (e) => {
            if (e.target.id === modalId) {
                hideModal(modalId);
                modal.removeEventListener('click', clickHandler);
            }
        };
        modal.addEventListener('click', clickHandler);
    } else {
        console.warn(`showModal: Modal con ID '${modalId}' non trovata.`);
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
    } else {
        console.warn(`hideModal: Modal con ID '${modalId}' non trovata.`);
    }
}