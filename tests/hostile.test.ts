/**
 * 恶意或异常文件：公式注入、超长单元格、超大数字、负数、超大表格。
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { csvCell } from '../src/core/export';
import { parseNumber } from '../src/core/numbers';
import { detectForPlatform, prepareDataset, runDiagnosis } from '../src/core/pipeline';
import { MAX_ROWS, readTable } from '../src/core/table';
import { normalizeHeader } from '../src/core/text';
import { SAMPLES } from '../src/samples/generate';

describe('导出 CSV 的公式注入', () => {
  it('分号分列的 Excel 里，单元格中间的公式也不会生效', () => {
    expect(csvCell('a;=1+1;b')).toBe('"a;=1+1;b"');
    expect(csvCell(';=HYPERLINK("x")')).toBe('";=HYPERLINK(""x"")"');
    expect(csvCell('a\t=1+1')).toBe('"a\t=1+1"');
  });

  it('开头有空白或零宽字符时也加前缀', () => {
    expect(csvCell(' =1+1')).toBe("' =1+1");
    expect(csvCell('​=1+1')).toBe("'​=1+1");
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('hiking backpack')).toBe('hiking backpack');
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('数字解析', () => {
  it('超长字符串直接判为无效，不会卡住', () => {
    const start = Date.now();
    for (let i = 0; i < 40; i++) expect(parseNumber('1'.repeat(30000) + 'x').invalid).toBe(true);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('千位分隔符必须三位一组', () => {
    expect(parseNumber('1,234.5')).toEqual({ value: 1234.5, invalid: false });
    expect(parseNumber('12,345,678')).toEqual({ value: 12345678, invalid: false });
    expect(parseNumber('1,2,3').invalid).toBe(true);
    expect(parseNumber('12,50').invalid).toBe(true);
    expect(parseNumber('1.234,5', 'comma')).toEqual({ value: 1234.5, invalid: false });
    expect(parseNumber('12,5', 'comma')).toEqual({ value: 12.5, invalid: false });
    expect(parseNumber('1.2.3', 'comma').invalid).toBe(true);
  });

  it('超过一万亿的数字按无效处理，不会让合计变成无穷大', () => {
    expect(parseNumber('1e308').invalid).toBe(true);
    expect(parseNumber('2000000000000').invalid).toBe(true);
    expect(parseNumber('999999999').value).toBe(999999999);
  });
});

describe('表头', () => {
  it('超长、括号不闭合的表头不会卡住识别', () => {
    const start = Date.now();
    normalizeHeader('('.repeat(60000));
    normalizeHeader('['.repeat(60000));
    expect(Date.now() - start).toBeLessThan(100);
    expect(normalizeHeader('7 Day Total Orders (#)')).toBe('7daytotalorders');
  });
});

describe('负数行', () => {
  it('订单为负数的行不做统计判断，也不会算出无穷大的客单价', () => {
    const s = SAMPLES['amazon-st']!();
    const rows = s.rows.map((r) => r.slice());
    const header = rows.findIndex((r) => r.some((c) => typeof c === 'string' && /orders/i.test(c)));
    const ordersCol = rows[header]!.findIndex((c) => typeof c === 'string' && /7 Day Total Orders/i.test(c));
    const termCol = rows[header]!.findIndex((c) => typeof c === 'string' && /Customer Search Term/i.test(c));
    // 同一个搜索词在样例里分成很多行，全部改成负数，合计后仍然是负数
    const term = rows[header + 1]![termCol];
    for (const r of rows.slice(header + 1)) if (r[termCol] === term) r[ordersCol] = -2;
    const sheets = [{ name: 'x', rows, rowOffset: 0 }];
    const det = detectForPlatform(sheets, 'amazon')!;
    const ds = prepareDataset(sheets, det, { price: s.amazonCosts!.price });
    const res = runDiagnosis({ platform: 'amazon', detection: det, dataset: ds, target: { type: 'amazonCosts', costs: s.amazonCosts! }, productText: s.product, price: s.amazonCosts!.price, today: new Date('2026-11-15') });
    if (!res.ok) throw new Error(res.error);
    const bad = res.report.results.filter((r) => r.row.orders < 0);
    expect(bad.length).toBeGreaterThan(0);
    for (const r of bad) {
      expect(r.tier).toBe('untested');
      expect(r.evidence.aov === null || Number.isFinite(r.evidence.aov)).toBe(true);
    }
    expect(Number.isFinite(res.report.summary.saving)).toBe(true);
  });
});

describe('超大表格', () => {
  const header = 'Customer Search Term,Clicks,Spend\n';

  it(`超过 ${MAX_ROWS} 行时给出明确提示，而不是让页面卡死`, async () => {
    const body = 'a,1,1\n'.repeat(MAX_ROWS + 1);
    await expect(readTable(new TextEncoder().encode(header + body), 'big.csv')).rejects.toThrow(/超过 200,000 行/);
  });

  it('末尾大量空行不算在内', async () => {
    const body = 'a,1,1\n'.repeat(10) + ',,\n'.repeat(MAX_ROWS + 5);
    const sheets = await readTable(new TextEncoder().encode(header + body), 'blank.csv');
    expect(sheets[0]!.rows.length).toBe(11);
  });

  it('声明的范围比实际内容大很多的 Excel：末尾空行不算，列数截到上限', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Customer Search Term', 'Clicks', 'Spend'],
      ['a', 1, 1],
    ]);
    // 范围声明到 ZZ 列、第 1000 行，实际只有两行三列
    ws['!ref'] = 'A1:ZZ1000';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const sheets = await readTable(bytes, 'inflated.xlsx');
    expect(sheets[0]!.rows.length).toBe(2);
    expect(Math.max(...sheets[0]!.rows.map((r) => r.length))).toBeLessThanOrEqual(300);
  });
});
