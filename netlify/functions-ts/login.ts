import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Metodo non consentito." }) };
  }

  try {
    const { password } = JSON.parse(event.body || "{}");
    const appPassword = process.env.APP_PASSWORD;

    if (!appPassword) {
      return { statusCode: 500, body: JSON.stringify({ error: "La password dell'applicazione non è configurata sul server." }) };
    }

    if (password === appPassword) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true }),
      };
    } else {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Password non valida." }),
      };
    }
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: "Richiesta non valida." }) };
  }
};

export { handler };
