// netlify/functions/normalize-products.ts
import { Handler } from '@netlify/functions';
import { NormalizeService } from '../../src/services/NormalizeService';

export const handler: Handler = async (evt) => {
  const { import_id } = JSON.parse(evt.body!);
  await NormalizeService.run(import_id);
  return { statusCode: 200, body: 'OK' };
};
