// Funzione per caricare un componente HTML tramite template
export async function loadComponent(componentName, targetElementId) {
    const response = await fetch(`components/${componentName}.html`);
    const text = await response.text();
    const template = document.createElement('template');
    template.innerHTML = text;
    const target = document.getElementById(targetElementId);
    if (target) {
        target.appendChild(template.content.cloneNode(true));
        return true;
    }
    console.error(`Elemento target con ID '${targetElementId}' non trovato per il componente '${componentName}'.`);
    return false;
}

// Funzione per mostrare un messaggio di notifica (sostituibile con una libreria toaster)
export function showNotification(message, type = 'info') {
    const statusDiv = document.getElementById('upload-status') || document.createElement('div'); // Fallback
    if (!statusDiv.id) { // Se è stato appena creato, aggiungilo al DOM per debugging o temporaneo
        statusDiv.id = 'temp-status-div';
        document.body.appendChild(statusDiv);
    }
    statusDiv.textContent = message;
    statusDiv.className = `upload-status ${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}`;
    statusDiv.classList.remove('hidden');

    // Nasconde il messaggio dopo un po'
    setTimeout(() => {
        statusDiv.classList.add('hidden');
    }, 5000);
}