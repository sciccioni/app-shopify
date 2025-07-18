// test-supabase-conn.js
// Script per testare la connessione a Supabase direttamente da Node.js

const { Client } = require('pg'); // Importa solo Client, non Pool, per un test diretto e singolo

// *** INCOLLA LA TUA STRINGA DI CONNESSIONE ESATTA QUI ***
// QUESTA DEVE ESSERE LA STESSA STRINGA CHE USI PER SUPABASE_URL su Netlify.
// Deve includere la tua password reale e l'host pooler.supabase.com
// Esempio: "postgresql://postgres.tuoref:tuaPASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?pgbouncer=true"
const CONNECTION_STRING = "postgresql://postgres.wqgfgvovwzcancgdsadc:cwVT73L14BJG@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?pgbouncer=true"; 

async function testConnection() {
    console.log("Tentativo di connessione a Supabase con la seguente stringa (password mascherata per sicurezza):");
    console.log(CONNECTION_STRING.replace(/:[^@]+@/, ':*****@')); // Logga la stringa mascherando la password

    const client = new Client({
        connectionString: CONNECTION_STRING,
        ssl: {
            rejectUnauthorized: false // Accetta certificati per connessioni HTTPS (Supabase)
        }
    });

    try {
        await client.connect();
        console.log("Connessione a Supabase riuscita! 🎉");

        // Tentativo di eseguire una query semplice per verificare l'autenticazione
        const res = await client.query('SELECT NOW()');
        console.log("Query di test eseguita con successo:", res.rows[0]);

        // Tenta di leggere le ditte (verifica che la tabella e le colonne siano accessibili)
        try {
            // Nota: qui useremo i nomi delle colonne del tuo DB Supabase
            // Le tue colonne sono ditta e markup_percentage
            const { rows } = await client.query('SELECT id, ditta as name, markup_percentage as markup FROM company_markups ORDER BY ditta ASC');
            console.log("Recupero ditte riuscito:", rows);
        } catch (queryError) {
            console.error("Errore durante il recupero delle ditte (la connessione è ok, ma la query ha fallito):", queryError.message);
            if (queryError.code) { // Codici errore PostgreSQL specifici
                console.error("Codice errore PG (Query):", queryError.code); // Es. '42P01' per tabella non trovata
            }
        }

    } catch (err) {
        console.error("ERRORE DI CONNESSIONE/AUTENTICAZIONE A SUPABASE:", err.message);
        // Logga l'oggetto errore completo per più dettagli se è un errore pg
        if (err.code) {
             console.error("Codice errore PG (Connessione):", err.code); // Es. 'XX000' per autenticazione fallita
             console.error("Severity:", err.severity);
        }
    } finally {
        if (client && client.end) { // Assicurati che client esista e abbia il metodo end
            await client.end(); // Chiudi la connessione
            console.log("Connessione chiusa.");
        } else {
            console.warn("Client PG non è stato inizializzato correttamente, impossibile chiudere la connessione.");
        }
    }
}

testConnection();