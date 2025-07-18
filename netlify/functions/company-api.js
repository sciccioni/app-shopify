// netlify/functions/company-api.js - AGGIORNATO (Conversione markup_percentage a numero)

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.SUPABASE_URL,
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
        client = await pool.connect();

        const { httpMethod, path, body } = event;
        const segments = path.split('/');
        const id = segments[segments.length - 1]; 
        const isCollectionPath = segments[segments.length - 1] === 'company-api'; 

        let responseBody;
        let statusCode = 200;

        switch (httpMethod) {
            case 'GET':
                // *** MODIFICA QUI: Conversione di markup_percentage a numero ***
                const { rows } = await client.query('SELECT id, ditta as name, CAST(markup_percentage AS NUMERIC) as markup FROM company_markups ORDER BY ditta ASC');
                // Alternativa: Converti in JS dopo la query, per esempio:
                // const { rows } = await client.query('SELECT id, ditta as name, markup_percentage FROM company_markups ORDER BY ditta ASC');
                // rows.forEach(row => row.markup = parseFloat(row.markup_percentage)); // Se preferisci la conversione lato JS
                responseBody = { companies: rows.map(row => ({
                    id: row.id,
                    name: row.name,
                    markup: parseFloat(row.markup) // Garantisci che sia un numero prima di inviarlo al frontend
                }))};
                break;

            case 'POST':
                if (!isCollectionPath) { statusCode = 400; responseBody = { message: 'Operazione POST non valida per un ID specifico.' }; break; }
                const { name, markup } = JSON.parse(body);
                if (!name || markup === undefined) { statusCode = 400; responseBody = { message: 'Nome ditta e markup sono obbligatori.' }; } else {
                    const { rows: insertedRows } = await client.query(
                        'INSERT INTO company_markups (ditta, markup_percentage) VALUES ($1, $2) RETURNING id, ditta as name, markup_percentage as markup, created_at',
                        [name, markup]
                    );
                    statusCode = 201; 
                    responseBody = { company: { // Ritorna l'oggetto correttamente formattato
                        id: insertedRows[0].id,
                        name: insertedRows[0].name,
                        markup: parseFloat(insertedRows[0].markup) // Converte anche qui al ritorno
                    }, message: 'Ditta aggiunta con successo.' };
                }
                break;

            case 'PUT':
                if (isCollectionPath) { statusCode = 400; responseBody = { message: 'Operazione PUT richiede un ID ditta.' }; break; }
                const { name: updateName, markup: updateMarkup } = JSON.parse(body);
                if (!id || !updateName || updateMarkup === undefined) { statusCode = 400; responseBody = { message: 'ID, nome ditta e markup sono obbligatori per l\'aggiornamento.' }; } else {
                    const { rowCount } = await client.query(
                        'UPDATE company_markups SET ditta = $1, markup_percentage = $2 WHERE id = $3',
                        [updateName, updateMarkup, id]
                    );
                    if (rowCount === 0) { statusCode = 404; responseBody = { message: 'Ditta non trovata.' }; } else { statusCode = 200; responseBody = { message: 'Ditta aggiornata con successo.' }; }
                }
                break;

            case 'DELETE':
                if (isCollectionPath) { statusCode = 400; responseBody = { message: 'Operazione DELETE richiede un ID ditta.' }; break; }
                if (!id) { statusCode = 400; responseBody = { message: 'ID ditta è obbligatorio per l\'eliminazione.' }; } else {
                    const { rowCount } = await client.query(
                        'DELETE FROM company_markups WHERE id = $1',
                        [id]
                    );
                    if (rowCount === 0) { statusCode = 404; responseBody = { message: 'Ditta non trovata.' }; } else { statusCode = 204; responseBody = {}; }
                }
                break;

            default:
                statusCode = 405; responseBody = { message: 'Metodo non permesso.' };
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
        let errorMessage = 'Errore interno del server.';
        if (error.message.includes('password authentication failed')) {
            errorMessage = 'Errore di autenticazione al database. Verifica password.';
        } else if (error.message.includes('connect ETIMEDOUT') || error.message.includes('ENOTFOUND')) {
            errorMessage = 'Impossibile connettersi al database. Verifica URL o stato del DB.';
        } else if (error.code && error.code.startsWith('42')) {
            errorMessage = 'Errore nel database: Verifica schema della tabella o query.';
        }
        
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