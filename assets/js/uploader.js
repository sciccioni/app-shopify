// assets/js/uploader.js - COMPLETO E CORRETTO

import { showUploaderStatus, updateUploaderProgress, toggleLoader } from './ui.js';

/**
 * Inizializza l'interfaccia di caricamento file e gestisce l'invio alla Netlify Function.
 * Accetta direttamente tutti gli elementi DOM necessari e la callback.
 * @param {object} options - Oggetto contenente gli elementi DOM e la callback.
 * @param {HTMLElement} options.dropArea - Elemento HTML per l'area di drop.
 * @param {HTMLInputElement} options.fileInput - Elemento HTML input di tipo file.
 * @param {HTMLElement} options.selectFileBtn - Elemento HTML bottone per selezionare file.
 * @param {HTMLElement} options.uploaderStatusDiv - Div per lo stato dell'uploader.
 * @param {HTMLElement} options.progressBarContainer - Contenitore della progress bar.
 * @param {HTMLElement} options.progressBar - La barra di progresso.
 * @param {HTMLElement} options.progressText - Testo della percentuale.
 * @param {HTMLElement} options.fileNameSpan - Span per il nome del file.
 * @param {function} options.onUploadSuccess - Callback da eseguire con i dati elaborati in caso di successo.
 */
export function initializeFileUploader({
    dropArea, fileInput, selectFileBtn,
    uploaderStatusDiv, progressBarContainer, progressBar, progressText, fileNameSpan,
    onUploadSuccess
}) {
    // Reset dello stato iniziale. Le funzioni di UI ora sanno quali elementi usare.
    showUploaderStatus(uploaderStatusDiv, '', false);
    updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);

    // Gestione Drag & Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('highlight'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('highlight'), false);
    });

    dropArea.addEventListener('drop', handleDrop, false);

    // Gestione selezione file da input
    selectFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    async function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        await handleFiles(files);
    }

    async function handleFiles(files) {
        if (files.length === 0) {
            showUploaderStatus(uploaderStatusDiv, 'Nessun file selezionato.', true);
            return;
        }

        const file = files[0];
        if (!file.name.endsWith('.xls') && !file.name.endsWith('.xlsx')) {
            showUploaderStatus(uploaderStatusDiv, 'Formato file non supportato. Carica un file .xls o .xlsx.', true);
            return;
        }

        showUploaderStatus(uploaderStatusDiv, 'Caricamento ed elaborazione in corso...', false);
        updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 10, file.name);

        const formData = new FormData();
        formData.append('excelFile', file);

        try {
            toggleLoader(true); // Mostra loader globale
            const response = await fetch('/.netlify/functions/process-excel', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Errore durante l\'elaborazione del file.');
            }

            const data = await response.json();
            updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 100, file.name);
            showUploaderStatus(uploaderStatusDiv, 'File elaborato con successo! Dati caricati per il confronto.', false);

            if (onUploadSuccess) {
                onUploadSuccess(data.processedProducts, data.shopifyProducts);
            }

        } catch (error) {
            console.error('Errore durante l\'upload o l\'elaborazione:', error);
            showUploaderStatus(uploaderStatusDiv, `Errore: ${error.message}`, true);
            updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0); // Resetta la progress bar
        } finally {
            toggleLoader(false); // Nasconde loader globale
        }
    }
}