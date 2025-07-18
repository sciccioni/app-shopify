// assets/js/uploader.js - Logica specifica per il caricamento file Excel

import { showUploaderStatus, updateUploaderProgress, toggleLoader } from './ui.js';

/**
 * Inizializza l'interfaccia di caricamento file e gestisce l'invio alla Netlify Function.
 * @param {function} onUploadSuccess - Callback da eseguire con i dati elaborati in caso di successo.
 */
export function initializeFileUploader(onUploadSuccess) {
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('fileInput');
    const selectFileBtn = document.getElementById('selectFileBtn');

    // **IMPORTANTE: Verifica che gli elementi siano stati trovati prima di aggiungere i listener**
    if (!dropArea || !fileInput || !selectFileBtn) {
        console.error("Errore: Elementi UI dell'uploader non trovati nel DOM. Assicurati che 'file-uploader.html' sia caricato correttamente nell'HTML prima di inizializzare uploader.js.");
        return; // Esce dalla funzione se gli elementi non ci sono
    }

    // Reset dello stato iniziale dell'uploader dopo che gli elementi sono disponibili
    showUploaderStatus('', false); // Nasconde eventuali messaggi precedenti
    updateUploaderProgress(0); // Resetta la progress bar

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
            showUploaderStatus('Nessun file selezionato.', true);
            return;
        }

        const file = files[0];
        if (!file.name.endsWith('.xls') && !file.name.endsWith('.xlsx')) {
            showUploaderStatus('Formato file non supportato. Carica un file .xls o .xlsx.', true);
            return;
        }

        showUploaderStatus('Caricamento ed elaborazione in corso...', false);
        updateUploaderProgress(10, file.name); // Inizia la progress bar

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
            updateUploaderProgress(100, file.name);
            showUploaderStatus('File elaborato con successo! Dati caricati per il confronto.', false);

            // Chiama la callback di successo per passare i dati al modulo principale
            if (onUploadSuccess) {
                onUploadSuccess(data.processedProducts, data.shopifyProducts);
            }

        } catch (error) {
            console.error('Errore durante l\'upload o l\'elaborazione:', error);
            showUploaderStatus(`Errore: ${error.message}`, true);
            updateUploaderProgress(0); // Resetta la progress bar in caso di errore
        } finally {
            toggleLoader(false); // Nasconde loader globale
        }
    }
}