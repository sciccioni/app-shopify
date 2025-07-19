import { showUploaderStatus, updateUploaderProgress, toggleLoader } from './ui.js';

/**
 * Inizializza l'interfaccia di caricamento file e gestisce l'invio alla Netlify Function.
 * Accetta direttamente tutti gli elementi DOM necessari e la callback.
 */
export function initializeFileUploader({
    dropArea, fileInput, selectFileBtn,
    uploaderStatusDiv, progressBarContainer, progressBar, progressText, fileNameSpan,
    onUploadSuccess
}) {
    // Stato iniziale
    showUploaderStatus(uploaderStatusDiv, '', false);
    updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);

    // Configura Drag & Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults);
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('highlight'));
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('highlight'));
    });
    dropArea.addEventListener('drop', handleDrop);

    // Selezione file
    selectFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => handleFiles(e.target.files));

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    async function handleDrop(e) {
        const files = e.dataTransfer.files;
        await handleFiles(files);
    }

    async function handleFiles(files) {
        if (!files.length) {
            showUploaderStatus(uploaderStatusDiv, 'Nessun file selezionato.', true);
            return;
        }
        const file = files[0];
        const ext = file.name.slice(-5).toLowerCase();
        if (!ext.endsWith('.xls') && !ext.endsWith('xlsx')) {
            showUploaderStatus(uploaderStatusDiv, 'Formato file non supportato. Carica un file .xls o .xlsx.', true);
            return;
        }

        showUploaderStatus(uploaderStatusDiv, 'Caricamento ed elaborazione in corso...', false);
        updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 10, file.name);

        const formData = new FormData();
        formData.append('excelFile', file);

        try {
            toggleLoader(true);
            console.log('[UPLOADER] Invio richiesta a /.netlify/functions/process-excel');
            const response = await fetch('/.netlify/functions/process-excel', { method: 'POST', body: formData });

            console.log('[UPLOADER] Risposta ricevuta. Status:', response.status);
            if (!response.ok) {
                // Gestione errori di rete e di status
                let errorMsg = `Errore server: ${response.status}`;
                try {
                    const errData = await response.json();
                    errorMsg = errData.message || errorMsg;
                    console.error('[UPLOADER] Dettagli errore:', errData);
                } catch (jsonErr) {
                    console.error('[UPLOADER] JSON non valido nella risposta di errore');
                }
                throw new Error(errorMsg);
            }

            let data;
            try {
                data = await response.json();
            } catch (parseErr) {
                console.error('[UPLOADER] Errore parsing JSON:', parseErr);
                throw new Error('Risposta non valida dal server. Riprova più tardi.');
            }
            console.log('[UPLOADER] Dati ricevuti:', data);

            updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 100, file.name);
            showUploaderStatus(uploaderStatusDiv, 'File elaborato con successo! Dati caricati per il confronto.', false);

            if (typeof onUploadSuccess === 'function') {
                try {
                    onUploadSuccess(
                        data.comparisonTableItems || [],
                        data.productsToUpdateOrCreate || [],
                        data.metrics || {}
                    );
                } catch (cbErr) {
                    console.error('[UPLOADER] Errore in onUploadSuccess:', cbErr);
                }
            }
        } catch (err) {
            console.error('[UPLOADER] Errore upload/elaborazione:', err);
            showUploaderStatus(uploaderStatusDiv, `Errore: ${err.message}`, true);
            updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);
        } finally {
            toggleLoader(false);
        }
    }
}
