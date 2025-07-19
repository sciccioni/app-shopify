import { showUploaderStatus, updateUploaderProgress, toggleLoader } from './ui.js';

/**
 * Carica il file tramite XMLHttpRequest per progressi e timeout configurabile.
 * @param {FormData} formData
 * @param {number} timeoutMs
 * @param {function(progressEvent)} onProgress
 * @returns {Promise<any>} Risolve con JSON parsed o reject con errore.
 */
function uploadFileXHR(formData, timeoutMs, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/.netlify/functions/process-excel', true);
        xhr.timeout = timeoutMs;

        xhr.upload.onprogress = event => {
            if (event.lengthComputable && typeof onProgress === 'function') {
                const percent = Math.round((event.loaded / event.total) * 100);
                onProgress(percent);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const json = JSON.parse(xhr.responseText);
                    resolve(json);
                } catch (err) {
                    reject(new Error('Risposta JSON non valida'));  
                }
            } else {
                let message = `Errore server: ${xhr.status}`;
                try {
                    const errData = JSON.parse(xhr.responseText);
                    message = errData.message || message;
                } catch {}
                reject(new Error(message));
            }
        };

        xhr.ontimeout = () => reject(new Error('Timeout di caricamento superato'));
        xhr.onerror = () => reject(new Error('Errore di rete durante l'upload'));

        xhr.send(formData);
    });
}

/**
 * Inizializza l'interfaccia di caricamento file usando XMLHttpRequest.
 */
export function initializeFileUploader({
    dropArea, fileInput, selectFileBtn,
    uploaderStatusDiv, progressBarContainer, progressBar, progressText, fileNameSpan,
    onUploadSuccess,
    uploadTimeout = 120000
}) {
    // Stato iniziale
    showUploaderStatus(uploaderStatusDiv, '', false);
    updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);

    // Drag & Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => dropArea.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(evt => dropArea.addEventListener(evt, () => dropArea.classList.add('highlight')));
    ['dragleave', 'drop'].forEach(evt => dropArea.addEventListener(evt, () => dropArea.classList.remove('highlight')));
    dropArea.addEventListener('drop', async e => await handleFiles(e.dataTransfer.files));

    // Selezione file
    selectFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async e => await handleFiles(e.target.files));

    async function handleFiles(files) {
        if (!files.length) {
            showUploaderStatus(uploaderStatusDiv, 'Nessun file selezionato.', true);
            return;
        }
        const file = files[0];
        const ext = file.name.toLowerCase().slice(-5);
        if (!ext.endsWith('.xls') && !ext.endsWith('xlsx')) {
            showUploaderStatus(uploaderStatusDiv, 'Formato non supportato. Usa .xls o .xlsx.', true);
            return;
        }

        showUploaderStatus(uploaderStatusDiv, 'Caricamento in corso...', false);
        updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0, file.name);
        toggleLoader(true);

        const formData = new FormData();
        formData.append('excelFile', file);

        try {
            const data = await uploadFileXHR(formData, uploadTimeout, percent => {
                updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, percent, file.name);
            });

            console.log('[UPLOADER] Dati ricevuti:', data);
            showUploaderStatus(uploaderStatusDiv, 'File elaborato con successo!', false);
            updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 100, file.name);

            onUploadSuccess?.(
                data.comparisonTableItems || [],
                data.productsToUpdateOrCreate || [],
                data.metrics || {}
            );
        } catch (err) {
            console.error('[UPLOADER] Errore upload/elaborazione:', err);
            showUploaderStatus(uploaderStatusDiv, `Errore: ${err.message}`, true);
            updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);
        } finally {
            toggleLoader(false);
        }
    }
}
