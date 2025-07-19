import { showUploaderStatus, updateUploaderProgress, toggleLoader } from './ui.js';

/**
 * Upload del file Excel ed elaborazione via endpoint singolo '/process-excel'.
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
  onUploadSuccess
}) {
  // Mostra pulsante, nascondi input file
  if (selectFileBtn) selectFileBtn.style.display = '';
  if (fileInput) fileInput.style.display = 'none';

  // Stato iniziale UI
  showUploaderStatus(uploaderStatusDiv, '', false);
  updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);

  // Drag & Drop
  ['dragenter','dragover','dragleave','drop'].forEach(evt => {
    dropArea.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation();
      if (evt === 'drop') handleFiles(e.dataTransfer.files);
    });
  });

  // Selezione file
  selectFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFiles(e.target.files));

  async function handleFiles(files) {
    if (!files || files.length === 0) {
      showUploaderStatus(uploaderStatusDiv, 'Nessun file selezionato.', true);
      return;
    }
    const file = files[0];
    const ext = file.name.toLowerCase().slice(-5);
    if (!ext.endsWith('.xls') && !ext.endsWith('xlsx')) {
      showUploaderStatus(uploaderStatusDiv, 'Formato non supportato. Usa .xls o .xlsx.', true);
      return;
    }
    await processFile(file);
  }

  async function processFile(file) {
    toggleLoader(true);
    try {
      // Avvia elaborazione
      showUploaderStatus(uploaderStatusDiv, 'Elaborazione file in corso...', false);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0, file.name);

      const formData = new FormData();
      formData.append('excelFile', file);

      const response = await fetch('/process-excel', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Elaborazione fallita (${response.status}): ${text}`);
      }

      const data = await response.json().catch(() => { throw new Error('Risposta non valida dal server'); });

      // Successo
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 100, file.name);
      showUploaderStatus(uploaderStatusDiv, 'File elaborato con successo!', false);

      onUploadSuccess?.(
        data.comparisonTableItems || [],
        data.productsToUpdateOrCreate || [],
        data.metrics || {}
      );
    } catch (err) {
      console.error('[UPLOADER] Errore elaborazione:', err);
      showUploaderStatus(uploaderStatusDiv, `Errore: ${err.message}`, true);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);
    } finally {
      toggleLoader(false);
    }
  }
}
