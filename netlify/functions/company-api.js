// netlify/functions/company-api.js - AGGIORNAMENTO DIAGNOSTICO FINALE

const { Pool } = require('pg');
const { URL } = require('url'); // Importa il modulo URL di Node.js

// --- INIZIO BLOCCO DIAGNOSTICO/CORREZIONE VARIABILE D'AMBIENTE ---
let connectionStringFromEnv = process.env.SUPABASE_URL;
let finalConnectionString = connectionStringFromEnv;

console.log('DEBUG (company-api): Valore grezzo di process.env.SUPABASE_URL:', connectionStringFromEnv ? `Stringa presente (lunghezza: ${connectionStringFromEnv.length})` : 'UNDEFINED o VUOTA!');

if (connectionStringFromEnv && connectionStringFromEnv.length > 0) {
    try {
        // Tenta di parsare la stringa come URL per verificare il formato.
        // Questo riprodurrà il controllo che fa pg-connection-string
        const testUrl = new URL(connectionStringFromEnv);
        console.log('DEBUG (company-api): Parsed URL protocol:', testUrl.protocol);
        console.log('DEBUG (company-api): Parsed URL hostname:', testUrl.hostname);
        console.log('DEBUG (company-api): Parsed URL port:', testUrl.port);
        console.log('DEBUG (company-api): Parsed URL username:', testUrl.username);
        console.log('DEBUG (company-api): Parsed URL password length:', testUrl.password ? testUrl.password.length : 0); // NON LOGGARE LA PASSWORD!
        console.log('DEBUG (company-api): Parsed URL pathname:', testUrl.pathname);
        console.log('DEBUG (company-api): Parsed URL searchParams (expected to be an object):', typeof testUrl.searchParams);

        // Se la stringa è stata parsata con successo, la riusiamo tale e quale
        // Altrimenti, se fallisce il parsing, finalConnectionString rimarrà l'originale
        // o verrà gestito dal catch esterno.
        finalConnectionString = connectionStringFromEnv;

    } catch (e) {
        console.error('DEBUG (company-api): Errore nel parsing di SUPABASE_URL come URL standard:', e.message);
        console.error('DEBUG (company-api): Questo suggerisce un formato errato o caratteri non codificati nella stringa.');
        // Tentativo di correzione euristica se la password ha caratteri speciali non codificati
        if (connectionStringFromEnv.includes('[YOUR-PASSWORD]')) {
             console.error('DEBUG (company-api): La stringa contiene ancora il placeholder [YOUR-PASSWORD]! Devi sostituirlo con la password reale e non le parentesi.');
        } else if (connectionStringFromEnv.includes('#') || connectionStringFromEnv.includes('&') || connectionStringFromEnv.includes('$') || connectionStringFromEnv.includes('%')) {
            console.warn('DEBUG (company-api): La stringa di connessione potrebbe contenere caratteri speciali non codificati URL. Riprova a codificare la password.');
            // Un'ultima risorsa: prova a ricodificare solo la password se c'è un pattern riconosciuto
            const parts = connectionStringFromEnv.match(/(.*?:)(.*?)(@.*)/);
            if (parts && parts[2]) {
                const encodedPassword = encodeURIComponent(parts[2]);
                finalConnectionString = parts[1] + encodedPassword + parts[3];
                console.log('DEBUG (company-api): Tentato di ricodificare la password nella stringa di connessione.');
            }
        }
    }
} else {
    // Se la variabile d'ambiente è effettivamente mancante o vuota
    throw new Error("Errore di configurazione: SUPABASE_URL non è impostata o è vuota nell'ambiente della funzione.");
}

// --- FINE BLOCCO DIAGNOSTICO/CORREZIONE ---

const pool = new Pool({
    connectionString: finalConnectionString, // Usa la stringa processata o diagnosticata
    ssl: {
        rejectUnauthorized: false
    }
});

exports.handler = async (event, context) => {
    let client;

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: ''
        };
    }

    try {
        client = await pool.connect(); // Questo è il punto in cui l'errore si manifesta

        const { httpMethod, path, body } = event;
        const segments = path.split('/');
        const id = segments[segments.length - 1];
        const isCollectionPath = segments[segments.length - 1] === 'company-api'; 

        let responseBody;
        let statusCode = 200;

        switch (httpMethod) {
            case 'GET':
                const { rows } = await client.query('SELECT id, ditta as name, markup_percentage as markup FROM company_markups ORDER BY ditta ASC');
                responseBody = { companies: rows };
                break;

            case 'POST':
                if (!isCollectionPath) {
                     statusCode = 400;
                     responseBody = { message: 'Operazione POST non valida per un ID specifico.' };
                     break;
                }
                const { name, markup } = JSON.parse(body);
                if (!name || markup === undefined) {
                    statusCode = 400;
                    responseBody = { message: 'Nome ditta e markup sono obbligatori.' };
                } else {
                    const { rows: insertedRows } = await client.query(
                        'INSERT INTO company_markups (ditta, markup_percentage) VALUES ($1, $2) RETURNING id, ditta as name, markup_percentage as markup, created_at',
                        [name, markup]
                    );
                    statusCode = 201;
                    responseBody = { company: insertedRows[0], message: 'Ditta aggiunta con successo.' };
                }
                break;

            case 'PUT':
                if (isCollectionPath) {
                     statusCode = 400;
                     responseBody = { message: 'Operazione PUT richiede un ID ditta.' };
                     break;
                }
                const { name: updateName, markup: updateMarkup } = JSON.parse(body);
                if (!id || !updateName || updateMarkup === undefined) {
                    statusCode = 400;
                    responseBody = { message: 'ID, nome ditta e markup sono obbligatori per l\'aggiornamento.' };
                } else {
                    const { rowCount } = await client.query(
                        'UPDATE company_markups SET ditta = $1, markup_percentage = $2 WHERE id = $3',
                        [updateName, updateMarkup, id]
                    );
                    if (rowCount === 0) {
                        statusCode = 404;
                        responseBody = { message: 'Ditta non trovata.' };
                    } else {
                        statusCode = 200;
                        responseBody = { message: 'Ditta aggiornata con successo.' };
                    }
                }
                break;

            case 'DELETE':
                if (isCollectionPath) {
                     statusCode = 400;
                     responseBody = { message: 'Operazione DELETE richiede un ID ditta.' };
                     break;
                }
                if (!id) {
                    statusCode = 400;
                    responseBody = { message: 'ID ditta è obbligatorio per l\'eliminazione.' };
                } else {
                    const { rowCount } = await client.query(
                        'DELETE FROM company_markups WHERE id = $1',
                        [id]
                    );
                    if (rowCount === 0) {
                        statusCode = 404;
                        responseBody = { message: 'Ditta non trovata.' };
                    } else {
                        statusCode = 204;
                        responseBody = {};
                    }
                }
                break;

            default:
                statusCode = 405;
                responseBody = { message: 'Metodo non permesso.' };
        }

        return {
            statusCode: statusCode,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: JSON.stringify(responseBody),
        };

    } catch (error) {
        console.error('Errore nella Netlify Function company-api:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: JSON.stringify({ message: `Errore interno del server: ${error.message}` }),
        };
    } finally {
        if (client) {
            client.release();
        }
    }
};