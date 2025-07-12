import { Handler } from '@netlify/functions';
import { DashboardService, DashboardStats } from '../../src/services/DashboardService';

const service = new DashboardService();

export const handler: Handler = async (event) => {
  try {
    const importId = Number(event.queryStringParameters?.import_id);
    if (!importId || isNaN(importId)) {
      return { statusCode: 400, body: 'Missing or invalid import_id parameter' };
    }

    const data: DashboardStats = await service.getStats(importId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (error: any) {
    return { statusCode: 500, body: error.message || 'Internal Server Error' };
  }
};
