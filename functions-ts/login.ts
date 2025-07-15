import { Handler } from '@netlify/functions';
import jwt from 'jsonwebtoken';

const APP_PASSWORD = process.env.APP_PASSWORD as string;
const JWT_SECRET = process.env.JWT_SECRET as string;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { password } = JSON.parse(event.body || '{}');
    if (password !== APP_PASSWORD) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Password errata' }) };
    }
    const token = jwt.sign({ authenticated: true }, JWT_SECRET, { expiresIn: '2h' });
    return { statusCode: 200, body: JSON.stringify({ token }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};
