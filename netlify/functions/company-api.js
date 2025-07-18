// netlify/functions/company-api.js - NUOVO ENDPOINT API PER LA GESTIONE DITTE (SUPABASE)

const { Pool } = require('pg'); // Importa il client PostgreSQL

// Configura il pool di connessioni a Supabase usando le variabili d'ambiente
const pool = new Pool({
    connectionString: process.env.SUPABASE_URL.replace('postgresql://', 'postgres://') + // Assicurati sia postgres:// per il driver pg
                      '?pgbouncer=true', // Abilita pgbouncer se stai usando il connection string di pgbouncer
    ssl: {
        rejectUnauthorized: false // Accetta certificati auto-firmati di Supabase (per il deploy)
    }
});

// Aggiungi un client per il Service Role Key per query dirette
const supabaseServiceRoleClient = (async () => {
    try {
        // Estrai le credenziali per la Service Role Key direttamente dall'URL di Supabase
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('SUPABASE_URL o SUPABASE_SERVICE_KEY non sono definiti.');
        }

        // Il client Supabase JS SDK è più comodo per l'API PostgREST con Service Key
        // Installalo se vuoi usarlo: npm install @supabase/supabase-js
        // const { createClient } = require('@supabase/supabase-js');
        // return createClient(supabaseUrl, supabaseServiceKey);

        // Alternativa: Se preferisci usare fetch direttamente per chiamate API PostgREST
        // Per semplicità, inizialmente useremo pg per le query dirette al DB via Pool.
        // Se volessimo usare la REST API di Supabase, questo sarebbe il posto per configurarla.
        return null; // Non usiamo un client SDK qui, ma una connessione diretta pg
    } catch (error) {
        console.error("Errore nel creare il client Supabase Service Role:", error);
        throw error;
    }
})();


exports.handler = async (event, context) => {
    let client; // Variabile per la connessione al database

    try {
        client = await pool.connect(); // Ottieni una connessione dal pool

        const { httpMethod, path, body, queryStringParameters } = event;
        const id = path.split('/').pop(); // Estrae l'ID dalla URL se presente

        let responseBody;
        let statusCode = 200;

        switch (httpMethod) {
            case 'GET':
                // Recupera tutte le ditte
                const { rows } = await client.query('SELECT id, ditta as name, markup_percentage as markup FROM company_markups ORDER BY ditta ASC');
                responseBody = { companies: rows };
                break;

            case 'POST':
                // Aggiungi una nuova ditta
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
                // Aggiorna una ditta esistente
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
                // Elimina una ditta
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
                        statusCode = 204; // No Content for successful delete
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
                'Access-Control-Allow-Origin': '*', // Permetti chiamate da qualsiasi origine (per testing)
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
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
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({ message: `Errore interno del server: ${error.message}` }),
        };
    } finally {
        if (client) {
            client.release(); // Rilascia la connessione al pool
        }
    }
};