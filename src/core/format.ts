/** 数字格式化（中文界面）。 */

const SYMBOLS: Record<string, string> = {
  USD: '$', CAD: 'C$', AUD: 'A$', MXN: 'MX$', BRL: 'R$', SGD: 'S$', CNY: '¥', JPY: '¥', EUR: '€', GBP: '£',
  INR: '₹', AED: 'AED ', SAR: 'SAR ', SEK: 'SEK ', PLN: 'zł ', TRY: '₺', $: '$', '¥': '¥',
};

export function currencySymbol(code: string | null | undefined, fallback = ''): string {
  if (!code) return fallback;
  return SYMBOLS[code] ?? `${code} `;
}

const FORMATS = new Map<number, Intl.NumberFormat>();
function numberFormat(digits: number): Intl.NumberFormat {
  let f = FORMATS.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    FORMATS.set(digits, f);
  }
  return f;
}

export function money(x: number | null | undefined, symbol: string, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const sign = x < 0 ? '-' : '';
  const v = numberFormat(digits).format(Math.abs(x));
  return `${sign}${symbol}${v}`;
}

export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function prob(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  if (p < 0.001) return '不到 0.1%';
  return `${(p * 100).toFixed(1)}%`;
}

export function int(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return Math.round(x).toLocaleString('en-US');
}

export function ratio(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return x.toFixed(digits);
}
