// netlify/functions/compute-diffs.ts
import { Handler } from '@netlify/functions';
import { DiffService } from '../../src/services/DiffService';

export const handler: Handler = async (evt) => {
  const { import_id } = JSON.parse(evt.body!);
  const diffs = await DiffService.run(import_id);
  return { statusCode: 200, body: JSON.stringify(diffs) };
};

