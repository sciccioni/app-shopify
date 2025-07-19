import { showUploaderStatus, updateUploaderProgress, toggleLoader } from './ui.js';

/**
 * Upload multi-stage con robusta gestione degli errori.
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

  // Eventi drag & drop
  ['dragenter','dragover','dragleave','drop'].forEach(evt => {
    dropArea.addEventListener(evt, e => {
      e.preventDefault(); e.stopPropagation();
      if (evt === 'drop') handleFiles(e.dataTransfer.files);
    });
  });

  // Eventi file input e pulsante
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
      // Step 1: upload
      showUploaderStatus(uploaderStatusDiv, 'Caricamento file...', false);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 10, file.name);
      const formData = new FormData();
      formData.append('excelFile', file);
      const importRes = await fetch('/api/import-excel', { method: 'POST', body: formData });
      if (!importRes.ok) {
        const text = await importRes.text();
        throw new Error(`Importazione fallita (${importRes.status}): ${text || importRes.statusText}`);
      }
      const importJson = await importRes.json().catch(() => { throw new Error('Risposta import-json non valida'); });
      const importId = importJson.importId;

      // Step 2: normalize
      showUploaderStatus(uploaderStatusDiv, 'Normalizzazione dati...', false);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 40, file.name);
      const normRes = await fetch('/api/normalize-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId })
      });
      if (!normRes.ok) {
        const text = await normRes.text();
        throw new Error(`Normalizzazione fallita (${normRes.status}): ${text || normRes.statusText}`);
      }

      // Step 3: compute diffs
      showUploaderStatus(uploaderStatusDiv, 'Confronto con Shopify...', false);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 70, file.name);
      const diffRes = await fetch('/api/compute-diffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId })
      });
      if (!diffRes.ok) {
        const text = await diffRes.text();
        throw new Error(`Computazione differenze fallita (${diffRes.status}): ${text || diffRes.statusText}`);
      }
      const diffJson = await diffRes.json().catch(() => { throw new Error('Risposta compute-diffs non valida'); });

      // Successo
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 100, file.name);
      showUploaderStatus(uploaderStatusDiv, 'Analisi completata!', false);
      onUploadSuccess?.(
        diffJson.comparisonTableItems || [],
        diffJson.productsToUpdateOrCreate || [],
        diffJson.metrics || {}
      );
    } catch (err) {
      console.error('[UPLOADER] Errore processo upload:', err);
      showUploaderStatus(uploaderStatusDiv, `Errore: ${err.message}`, true);
      updateUploaderProgress(progressBarContainer, progressBar, progressText, fileNameSpan, 0);
    } finally {
      toggleLoader(false);
    }
  }
}
