import { describe, expect, it } from 'vitest';
import { parseCsv, sniffDelimiter } from '../src/core/csv';
import { decodeText } from '../src/core/decode';
import { inferDecimalStyle, parseDate, parseNumber } from '../src/core/numbers';
import { normalizeHeader, tokenize } from '../src/core/text';

describe('parseNumber', () => {
  const ok: [unknown, number][] = [
    [12, 12],
    ['12', 12],
    ['$1,234.56', 1234.56],
    ['US$1,234.56', 1234.56],
    ['¥8,900', 8900],
    ['￥89.00', 89],
    ['1.2万', 12000],
    ['3亿', 300000000],
    ['12.5%', 0.125],
    ['(12.34)', -12.34],
    [' 7 ', 7],
    ['0', 0],
    ['1e3', 1000],
    ['€ 12,50', 12.5],
  ];
  it.each(ok)('parses %s', (raw, expected) => {
    const style = typeof raw === 'string' && /,\d{2}$/.test(raw) ? 'comma' : 'dot';
    expect(parseNumber(raw, style).value).toBeCloseTo(expected, 9);
  });
  it('treats placeholders as empty, not invalid', () => {
    for (const v of ['', '-', '--', '—', 'N/A', null, undefined]) {
      expect(parseNumber(v)).toEqual({ value: null, invalid: false });
    }
  });
  it('flags garbage as invalid instead of guessing', () => {
    expect(parseNumber('abc').invalid).toBe(true);
    expect(parseNumber('12abc').invalid).toBe(true);
  });
  it('handles European decimals by column', () => {
    expect(inferDecimalStyle(['1.234,56', '12,50', '3,00'])).toBe('comma');
    expect(inferDecimalStyle(['1,234.56', '12.50', '1,000'])).toBe('dot');
    expect(parseNumber('1.234,56', 'comma').value).toBeCloseTo(1234.56, 9);
  });
});

describe('parseDate', () => {
  it.each([
    ['2026-10-01', '2026-10-01'],
    ['2026/10/01', '2026-10-01'],
    ['2026年10月1日', '2026-10-01'],
    ['10/01/2026', '2026-10-01'],
    ['25/10/2026', '2026-10-25'],
    ['01.11.2026', '2026-11-01'],
    ['Nov 01, 2026', '2026-11-01'],
    ['November 1, 2026', '2026-11-01'],
    ['1 Nov 2026', '2026-11-01'],
  ])('%s → %s', (raw, expected) => {
    expect(parseDate(raw)).toBe(expected);
  });
  it('converts Excel serial numbers without timezone drift', () => {
    expect(parseDate(46296)).toBe('2026-10-01');
  });
});

describe('CSV', () => {
  it('handles quotes, escaped quotes and embedded newlines', () => {
    const rows = parseCsv('a,b,c\n"x, y","he said ""hi""","line1\nline2"\n1,2,3\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2'],
      ['1', '2', '3'],
    ]);
  });
  it('sniffs tab and semicolon delimiters', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(sniffDelimiter('a;b;c\n1;2,5;3')).toBe(';');
    expect(sniffDelimiter('标题行\n时间,范围\na,b,c\n1,2,3')).toBe(',');
  });
});

describe('decodeText', () => {
  it('detects GB18030 encoded Chinese CSV', () => {
    // “搜索词,消耗” 的 GBK 编码
    const bytes = new Uint8Array([0xcb, 0xd1, 0xcb, 0xf7, 0xb4, 0xca, 0x2c, 0xcf, 0xfb, 0xba, 0xc4]);
    const r = decodeText(bytes);
    expect(r.text).toBe('搜索词,消耗');
    expect(r.encoding).toBe('GB18030');
  });
  it('strips UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('日期,花费')]);
    expect(decodeText(bytes)).toEqual({ text: '日期,花费', encoding: 'UTF-8 (BOM)' });
  });
});

describe('normalizeHeader / tokenize', () => {
  it('normalizes headers', () => {
    expect(normalizeHeader('7 Day Total Orders (#)')).toBe('7daytotalorders');
    expect(normalizeHeader('7 Day Total Sales ')).toBe('7daytotalsales');
    expect(normalizeHeader('成交金额（元）')).toBe('成交金额');
    expect(normalizeHeader('Customer Search Term')).toBe('customersearchterm');
  });
  it('tokenizes English and Chinese', () => {
    expect(tokenize('Kids School Backpacks')).toEqual(['kid', 'school', 'backpack']);
    const zh = tokenize('儿童防晒衣');
    expect(zh.join('')).toContain('防晒');
  });
});
