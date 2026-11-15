/**
 * 数字解析。原则：宁可识别失败报错，也不能把数字读错。
 * 支持：货币符号、千分位、欧洲小数逗号、百分号、中文“万/亿”、括号负数、"--" 等空值写法。
 */

const NULL_TOKENS = new Set(['', '-', '--', '---', '—', '——', 'n/a', 'na', 'null', 'none', '/', '\\', '无', '暂无']);

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/US\$|USD/i, 'USD'],
  [/CA\$|CAD/i, 'CAD'],
  [/AU\$|AUD/i, 'AUD'],
  [/MX\$|MXN/i, 'MXN'],
  [/R\$|BRL/i, 'BRL'],
  [/S\$|SGD/i, 'SGD'],
  [/CN¥|RMB|CNY|元|￥/i, 'CNY'],
  [/JP¥|JPY|円/i, 'JPY'],
  [/EUR|€/i, 'EUR'],
  [/GBP|£/i, 'GBP'],
  [/INR|₹/i, 'INR'],
  [/AED/i, 'AED'],
  [/SAR/i, 'SAR'],
  [/SEK/i, 'SEK'],
  [/PLN|zł/i, 'PLN'],
  [/TRY|₺/i, 'TRY'],
  [/\$/, '$'],
  [/¥/, '¥'],
];

/** 从单元格文本里识别货币，识别不到返回 null */
export function detectCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  for (const [re, code] of CURRENCY_PATTERNS) if (re.test(raw)) return code;
  return null;
}

export type DecimalStyle = 'dot' | 'comma';

/**
 * 根据整列数据判断小数分隔符。出现 "12,50" 或 "1.234,56" 这种写法就判为欧洲格式。
 * 只出现 "1,234" 时按千分位处理（中美格式更常见）。
 */
export function inferDecimalStyle(values: unknown[]): DecimalStyle {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = stripDecorations(v);
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) comma++;
    else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s) || /^-?\d+\.\d+$/.test(s)) dot++;
  }
  return comma > dot ? 'comma' : 'dot';
}

function stripDecorations(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/US\$|CA\$|AU\$|MX\$|R\$|S\$|CN¥|JP¥|USD|CAD|AUD|MXN|BRL|SGD|RMB|CNY|JPY|EUR|GBP|INR|AED|SAR|SEK|PLN|TRY/gi, '')
    .replace(/[$€£¥￥₹₺元円]|zł/g, '')
    .replace(/[\s  ']/g, '')
    .trim();
}

/**
 * 计数类字段（展示、点击、订单、互动）必须是整数。
 * 如果按小数点解析出了非整数，而原文是 "1.523" 这种三位一组的写法，说明点是千分位。
 */
export function parseCount(raw: unknown, style: DecimalStyle = 'dot'): ParsedNumber {
  const p = parseNumber(raw, style);
  if (p.value !== null && !Number.isInteger(p.value) && typeof raw === 'string') {
    const s = stripDecorations(raw);
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return { value: Number(s.replace(/\./g, '')), invalid: false };
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return { value: Number(s.replace(/,/g, '')), invalid: false };
  }
  return p;
}

export interface ParsedNumber {
  value: number | null;
  /** 文本存在但无法解析 */
  invalid: boolean;
}

export function parseNumber(raw: unknown, style: DecimalStyle = 'dot'): ParsedNumber {
  if (raw === null || raw === undefined) return { value: null, invalid: false };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, invalid: false } : { value: null, invalid: true };
  if (typeof raw === 'boolean') return { value: null, invalid: true };
  const original = String(raw).trim();
  if (NULL_TOKENS.has(original.toLowerCase())) return { value: null, invalid: false };

  // 正常的数字不会这么长；先拦住，避免超长字符串让下面的正则跑很久
  if (original.length > 40) return { value: null, invalid: true };
  let s = stripDecorations(original);
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  let multiplier = 1;
  if (s.endsWith('%')) {
    multiplier = 0.01;
    s = s.slice(0, -1);
  } else if (s.endsWith('亿')) {
    multiplier = 1e8;
    s = s.slice(0, -1);
  } else if (s.endsWith('万')) {
    multiplier = 1e4;
    s = s.slice(0, -1);
  }
  if (style === 'comma') {
    if (s.includes('.') && !/^[-+]?\d{1,3}(\.\d{3})+(,\d*)?$/.test(s)) return { value: null, invalid: true };
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // 千位分隔符必须三位一组，“1,2,3”“12,50”不当成数字（后者可能是欧洲写法的小数）
    if (s.includes(',') && !/^[-+]?\d{1,3}(,\d{3})+(\.\d*)?(e[-+]?\d+)?$/i.test(s)) return { value: null, invalid: true };
    s = s.replace(/,/g, '');
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return { value: null, invalid: true };
  let value = Number(s) * multiplier;
  if (negative) value = -value;
  // 超过一万亿的数字在广告报表里不合理，按无效处理，避免后面的合计溢出成无穷大
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) return { value: null, invalid: true };
  // 修正 0.1 * 3 这类浮点误差带来的长尾小数
  value = Math.round(value * 1e9) / 1e9;
  return { value, invalid: false };
}

/** Excel 序列号日期 → ISO 日期（与时区无关） */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

export type DateOrder = 'mdy' | 'dmy';

/**
 * 按整列判断“月/日/年”还是“日/月/年”：只要有一个值的第一段大于 12，整列都是日/月/年。
 * 逐个单元格判断会把英国格式的 01/11 读成 1 月 11 日、30/11 读成 11 月 30 日，周期就乱了。
 */
export function inferDateOrder(values: unknown[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = v.normalize('NFKC').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (!m) continue;
    if (v.includes('.') && !v.includes('/')) dmy++;
    else if (+m[1]! > 12) dmy++;
    else if (+m[2]! > 12) mdy++;
  }
  return dmy > mdy ? 'dmy' : 'mdy';
}

/**
 * 日期解析。只用于计算报告周期和归因延迟提醒。月日不明确时按 order 处理（由整列推断）。
 */
export function parseDate(raw: unknown, order: DateOrder = 'mdy'): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return excelSerialToISO(raw);
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw).normalize('NFKC').trim();
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = +m[3]!;
    if (s.includes('.') && !s.includes('/')) return iso(y, b, a); // 德式 01.11.2026
    if (a > 12) return iso(y, b, a);
    if (b > 12) return iso(y, a, b);
    return order === 'dmy' ? iso(y, b, a) : iso(y, a, b);
  }
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
    if (mon) return iso(+m[3]!, mon, +m[2]!);
  }
  m = s.match(/^(\d{1,2})\.?\s+([A-Za-z]+)\.?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[2]!.slice(0, 3).toLowerCase()];
    if (mon) return iso(+m[3]!, mon, +m[1]!);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToISO(Number(s));
  return null;
}

export function daysBetween(startISO: string, endISO: string): number {
  return Math.round((Date.parse(endISO) - Date.parse(startISO)) / 86400000) + 1;
}
