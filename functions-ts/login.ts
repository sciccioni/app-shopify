import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  // Accetta solo richieste di tipo POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405, // Metodo non consentito
      body: JSON.stringify({ error: "Metodo non consentito." }),
    };
  }

  try {
    const { password } = JSON.parse(event.body || "{}");
    const appPassword = process.env.APP_PASSWORD;

    // Controlla se la password di sistema è configurata su Netlify
    if (!appPassword) {
      console.error("La variabile d'ambiente APP_PASSWORD non è impostata.");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "La password dell'applicazione non è configurata sul server." }),
      };
    }

    // Confronta la password inviata con quella di sistema
    if (password === appPassword) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: "Login effettuato con successo." }),
      };
    } else {
      return {
        statusCode: 401, // Non autorizzato
        body: JSON.stringify({ error: "Password non valida." }),
      };
    }
  } catch (error) {
    return {
      statusCode: 400, // Richiesta non valida
      body: JSON.stringify({ error: "Richiesta non valida o malformata." }),
    };
  }
};

export { handler };
