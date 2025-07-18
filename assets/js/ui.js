// assets/js/ui.js - AGGIORNATO PER RISOLVERE ERRORE NULL

/**
 * Carica un componente HTML da un file template.
 * Non lo inietta direttamente, ma restituisce l'elemento root del componente.
 * Sarà responsabilità del chiamante (es. main.js) inserirlo nel DOM.
 * @param {string} componentName - Il nome del file del componente (es. 'file-uploader').
 * @returns {Promise<HTMLElement|null>} L'elemento HTML root del componente caricato e clonato, o null in caso di errore.
 */
export async function loadComponent(componentName) { // Rimosso targetElementId qui
    try {
        const response = await fetch(`components/${componentName}.html`);
        if (!response.ok) {
            console.error(`Errore HTTP durante il caricamento del componente ${componentName}.html: ${response.status} ${response.statusText}`);
            return null;
        }
        const text = await response.text();
        const template = document.createElement('template');
        template.innerHTML = text;

        // Clona il contenuto del template e restituisci il primo elemento figlio.
        // Questo sarà il div radice del tuo componente (es. .file-uploader-container o .comparison-table-container).
        // Questo elemento è ora disconnesso dal DOM finché non viene append.
        if (template.content.firstElementChild) {
            return template.content.firstElementChild.cloneNode(true);
        } else {
            console.error(`Il template ${componentName}.html non contiene un elemento radice.`);
            return null;
        }
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
 * Mostra un messaggio di stato nell'uploader.
 * Questa funzione ora opera su elementi passati, non cerca globalmente.
 * @param {HTMLElement} statusDiv - L'elemento div dove mostrare lo stato.
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
        console.warn('Elemento statusDiv non fornito per showUploaderStatus. Messaggio: ' + message);
    }
}

/**
 * Aggiorna lo stato della progress bar dell'uploader.
 * Questa funzione ora opera su elementi passati, non cerca globalmente.
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
        console.warn('Elementi della progress bar non forniti per updateUploaderProgress.');
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
        // Aggiungi un listener per chiudere la modal cliccando sull'overlay
        // Questo listener è aggiunto solo una volta quando la modal viene mostrata
        const clickHandler = (e) => {
            if (e.target.id === modalId) {
                hideModal(modalId);
                modal.removeEventListener('click', clickHandler); // Rimuovi il listener dopo il click
            }
        };
        modal.addEventListener('click', clickHandler);
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