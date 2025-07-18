// netlify/functions/company-api.js - VERSIONE COMPLETA, CON LOGGING SENSIBILE PER DEBUG PASSWORD

const { Pool } = require('pg');
const { URL } = require('url'); // Importa il modulo URL di Node.js

// --- INIZIO BLOCCO DIAGNOSTICO CRITICO (Rimuovere immediatamente dopo il debug!) ---
let connectionStringFromEnv = process.env.SUPABASE_URL;
let finalConnectionString = connectionStringFromEnv;

console.log('--- INIZIO DEBUG CONNESSIONE SUPABASE ---');
console.log('DEBUG: Valore grezzo di process.env.SUPABASE_URL:', connectionStringFromEnv ? `Stringa presente (lunghezza: ${connectionStringFromEnv.length})` : 'UNDEFINED o VUOTA!');

if (connectionStringFromEnv && connectionStringFromEnv.length > 0) {
    try {
        const parsedUrl = new URL(connectionStringFromEnv);
        // *** ATTENZIONE: LOGGING DI CREDENZIALI SENSIBILI! ***
        // *** QUESTI CONSOLE.LOG DEVONO ESSERE RIMOSSI IMMEDIATAMENTE DOPO IL DEBUG! ***
        console.log('DEBUG: Tentativo di connessione con Username:', parsedUrl.username);
        console.log('DEBUG: Tentativo di connessione con Password:', parsedUrl.password); // !!! Rimuovi questo SUBITO !!!
        // ***************************************************

        finalConnectionString = connectionStringFromEnv; // Usa la stringa originale se parsata correttamente

    } catch (e) {
        console.error('DEBUG: Errore nel parsing di SUPABASE_URL come URL standard:', e.message);
        console.error('DEBUG: Questo suggerisce un formato errato o caratteri non codificati nella stringa.');
        // Se il parsing fallisce, potremmo ancora avere un problema con la stringa, anche se meno probabile ora.
        // Tentativo di fallback se la password ha caratteri speciali, ma il problema più comune è ora la corrispondenza.
    }
} else {
    // Se la variabile d'ambiente è effettivamente mancante o vuota
    throw new Error("Errore di configurazione: SUPABASE_URL non è impostata o è vuota nell'ambiente della funzione.");
}
console.log('--- FINE DEBUG CONNESSIONE SUPABASE ---');
// --- FINE BLOCCO DIAGNOSTICO CRITICO ---


const pool = new Pool({
    connectionString: finalConnectionString,
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