/** 把上传的文件读成二维表。Excel 用 SheetJS（按需加载），CSV/TXT 用自带解析器。 */
import { parseCsv } from './csv';
import { decodeText } from './decode';
import type { Cell, Sheet } from './types';

const EXCEL_EXT = new Set(['xlsx', 'xlsm', 'xlsb', 'xls', 'ods']);
const TEXT_EXT = new Set(['csv', 'tsv', 'txt']);

function extension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1]! : '';
}

function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function isOle(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
}

export class UnsupportedFileError extends Error {}

/** 浏览器里能顺畅计算的上限；更大的报表按日期分段导出 */
export const MAX_ROWS = 200_000;
/** 列数上限：广告报表不会有这么多列，超出的部分（通常是空的格式区域）直接丢掉 */
export const MAX_COLS = 300;

const isBlank = (r: Cell[] | undefined) => !r || r.every((c) => c === null || c === undefined || c === '');

function checkRows(all: Cell[][]): Cell[][] {
  // 末尾的空行不算（有的表格声明的范围远大于实际内容）
  let end = all.length;
  while (end > 0 && isBlank(all[end - 1])) end--;
  const rows = end === all.length ? all : all.slice(0, end);
  if (rows.length > MAX_ROWS) {
    throw new UnsupportedFileError(`报表超过 ${MAX_ROWS.toLocaleString('en-US')} 行，浏览器里计算会非常慢。请缩短日期范围，或按日期分成几份分别上传。`);
  }
  return rows.map((r) => (r.length > MAX_COLS ? r.slice(0, MAX_COLS) : r));
}

export async function readTable(bytes: Uint8Array, fileName: string): Promise<Sheet[]> {
  if (bytes.length === 0) throw new UnsupportedFileError('文件是空的');
  const ext = extension(fileName);
  const excel = EXCEL_EXT.has(ext) || (!TEXT_EXT.has(ext) && (isZip(bytes) || isOle(bytes)));
  if (excel) return readExcel(bytes);
  if (isZip(bytes) || isOle(bytes)) return readExcel(bytes);
  const { text, encoding } = decodeText(bytes);
  const rows = checkRows(parseCsv(text));
  return [{ name: fileName || 'CSV', rows, rowOffset: 0, encoding }];
}

async function readExcel(bytes: Uint8Array): Promise<Sheet[]> {
  const XLSX = await import('xlsx');
  let wb;
  try {
    // sheetRows：多读一行用来判断是否超过上限，同时防止表格声明的范围很大（例如一百万行）时整张读进来
    wb = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: false, cellText: false, dense: true, sheetRows: MAX_ROWS + 1 });
  } catch (e) {
    throw new UnsupportedFileError(`Excel 文件无法读取：${(e as Error).message}`);
  }
  const sheets: Sheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    // 声明的范围可能远大于实际内容，先把列数截到上限再转换
    if (range.e.c >= MAX_COLS) range.e.c = MAX_COLS - 1;
    const rows = checkRows(XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range }));
    sheets.push({ name, rows, rowOffset: range.s.r });
  }
  if (sheets.length === 0) throw new UnsupportedFileError('Excel 文件里没有数据');
  return sheets;
}
