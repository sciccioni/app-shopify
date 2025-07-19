import { showUploaderStatus, updateUploaderProgress, toggleLoader } from './ui.js';

/**
 * Upload multi-stage per Excel e confronto Shopify
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
  // Mostra il pulsante e nasconde l'input nativo
  if (selectFileBtn) selectFileBtn.style.display = '';
  if (fileInput) fileInput.style.display = 'none';

  // Stato iniziale UI
  showUploaderStatus(uploaderStatusDiv, '', false);
  updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);

  // Eventi Drag & Drop e click
  selectFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFiles(e.target.files));
  ['dragenter','dragover','dragleave','drop'].forEach(evt => {
    dropArea.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation();
      if (evt === 'drop') handleFiles(e.dataTransfer.files);
    });
  });

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
    try {
      toggleLoader(true);

      // Step 1: upload file
      showUploaderStatus(uploaderStatusDiv, 'Caricamento file...', false);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 10, file.name);
      const formData = new FormData();
      formData.append('excelFile', file);
      const importRes = await fetch('/api/import-excel', { method: 'POST', body: formData });
      const importJson = await importRes.json();
      if (!importRes.ok) throw new Error(importJson.error || 'Errore importazione');
      const importId = importJson.importId;

      // Step 2: normalize
      showUploaderStatus(uploaderStatusDiv, 'Normalizzazione dati...', false);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 40, file.name);
      const normRes = await fetch('/api/normalize-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId })
      });
      const normJson = await normRes.json();
      if (!normRes.ok) throw new Error(normJson.error || 'Errore normalizzazione');

      // Step 3: compute diffs
      showUploaderStatus(uploaderStatusDiv, 'Confronto con Shopify...', false);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 70, file.name);
      const diffRes = await fetch('/api/compute-diffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId })
      });
      const diffJson = await diffRes.json();
      if (!diffRes.ok) throw new Error(diffJson.error || 'Errore differenze');

      // Successo
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 100, file.name);
      showUploaderStatus(uploaderStatusDiv, 'Analisi completata!', false);
      onUploadSuccess?.(
        diffJson.comparisonTableItems || [],
        diffJson.productsToUpdateOrCreate || [],
        diffJson.metrics || {}
      );
    } catch (err) {
      console.error('[UPLOADER] Errore:', err);
      showUploaderStatus(uploaderStatusDiv, `Errore: ${err.message}`, true);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);
    } finally {
      toggleLoader(false);
    }
  }
}