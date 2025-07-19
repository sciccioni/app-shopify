import { showUploaderStatus, updateUploaderProgress, toggleLoader } from './ui.js';

/**
 * Upload function via XMLHttpRequest with detailed error handling
 */
export function initializeFileUploader({
  dropArea,
  fileInput,
  selectFileBtn,
  uploaderStatusDiv,
  progressBarContainer,
  progressBar,
  progressText,
  fileNameSpan,
  onUploadSuccess,
  uploadTimeout = 120000
}) {
  // Initial state
  showUploaderStatus(uploaderStatusDiv, '', false);
  updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);

  // Drag & Drop setup
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropArea.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
    });
  });
  ['dragenter', 'dragover'].forEach(evt => dropArea.addEventListener(evt, () => dropArea.classList.add('highlight')));
  ['dragleave', 'drop'].forEach(evt => dropArea.addEventListener(evt, () => dropArea.classList.remove('highlight')));
  dropArea.addEventListener('drop', handleFiles);

  // File input setup
  selectFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFiles(e.target.files));

  function handleFiles(fileListOrEvent) {
    const files = fileListOrEvent instanceof Event ? fileListOrEvent.dataTransfer.files : fileListOrEvent;
    if (!files || files.length === 0) {
      showUploaderStatus(uploaderStatusDiv, 'Nessun file selezionato.', true);
      return;
    }
    upload(files[0]);
  }

  function upload(file) {
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

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/.netlify/functions/process-excel', true);
    xhr.timeout = uploadTimeout;

    xhr.upload.onprogress = event => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, percent, file.name);
      }
    };

    xhr.onload = () => {
      console.log('[UPLOADER] Response status:', xhr.status);
      let message = `Errore server: ${xhr.status}`;
      let responseObj;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          responseObj = JSON.parse(xhr.responseText);
        } catch (e) {
          console.error('[UPLOADER] JSON parsing error:', e, 'Raw response:', xhr.responseText);
          showUploaderStatus(uploaderStatusDiv, 'Risposta non valida dal server.', true);
          toggleLoader(false);
          return;
        }
        console.log('[UPLOADER] Dati ricevuti:', responseObj);
        updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 100, file.name);
        showUploaderStatus(uploaderStatusDiv, 'File elaborato con successo!', false);
        onUploadSuccess?.(
          responseObj.comparisonTableItems || [],
          responseObj.productsToUpdateOrCreate || [],
          responseObj.metrics || {}
        );
      } else {
        // Error status
        if (xhr.responseText) {
          try {
            responseObj = JSON.parse(xhr.responseText);
            message = responseObj.message || message;
            console.error('[UPLOADER] Dettaglio errore:', responseObj);
          } catch {
            console.error('[UPLOADER] Raw error response:', xhr.responseText);
          }
        }
        showUploaderStatus(uploaderStatusDiv, message, true);
      }
      toggleLoader(false);
    };

    xhr.ontimeout = () => {
      console.error('[UPLOADER] Timeout exceeded');
      showUploaderStatus(uploaderStatusDiv, 'Timeout di caricamento superato. Riprova.', true);
      toggleLoader(false);
    };

    xhr.onerror = () => {
      console.error('[UPLOADER] Network error');
      showUploaderStatus(uploaderStatusDiv, 'Errore di rete durante l'upload.', true);
      toggleLoader(false);
    };

    xhr.send(formData);
  }
}
