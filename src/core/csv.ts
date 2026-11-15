/** RFC 4180 CSV 解析（支持引号、转义引号、引号内换行），自动识别分隔符。 */

const CANDIDATES = [',', '\t', ';', '|'] as const;

function countOutsideQuotes(line: string, delim: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delim) count++;
  }
  return count;
}

/** 取前若干个非空行，选“每行出现次数稳定且最多”的分隔符 */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 30);
  if (lines.length === 0) return ',';
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const nonzero = counts.filter((c) => c > 0);
    if (nonzero.length === 0) continue;
    // 众数出现的行数 × 众数，偏好在多数行里一致出现的分隔符
    const freq = new Map<number, number>();
    for (const c of nonzero) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modeCount = 0;
    let mode = 0;
    for (const [c, f] of freq) {
      if (f > modeCount || (f === modeCount && c > mode)) {
        modeCount = f;
        mode = c;
      }
    }
    const score = modeCount * 1000 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
