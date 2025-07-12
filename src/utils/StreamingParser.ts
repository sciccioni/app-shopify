// src/utils/StreamingParser.ts
import { Readable } from 'stream';
import XLSX from 'xlsx';

export async function parseXLSX(buffer: Buffer, onRow: (row: any) => Promise<void>) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(sheet, { raw: false });
  for (const row of json) {
    await onRow(row);
  }
}
