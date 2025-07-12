// netlify/functions/import-excel.ts
import { Handler } from '@netlify/functions';
import { ImportService } from '../../src/services/ImportService';
import jwt from 'jsonwebtoken';

export const handler: Handler = async (event) => {
  // autenticazione JWT con APP_PASSWORD
  const token = event.headers.authorization?.split(' ')[1];
  if (!token || jwt.verify(token, process.env.JWT_SECRET!) !== process.env.APP_PASSWORD) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  const file = Buffer.from(event.body!, 'base64');
  try {
    const importId = await ImportService.run(file);
    return { statusCode: 200, body: JSON.stringify({ importId }) };
  } catch (e: any) {
    return { statusCode: 400, body: e.message };
  }
};
