// netlify/functions/check-password.js
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    try {
        const { password } = JSON.parse(event.body);
        const correctPassword = process.env.APP_PASSWORD;

        if (password && password === correctPassword) {
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
        } else {
            return { statusCode: 401, body: JSON.stringify({ success: false }) };
        }
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal Server Error' }) };
    }
};
