/**
 * 把识别好列的表格转成可分析的数据：解析数字、排除合计行、按维度汇总按天拆分的数据，并做数据质量检查。
 * 每一步被排除或修正的数据都会记录下来，展示给用户核对。
 */
import type { Detection } from './detect';
import { daysBetween, detectCurrency, inferDateOrder, inferDecimalStyle, parseCount, parseDate, parseNumber, type DateOrder, type DecimalStyle } from './numbers';
import { cleanText, normalizeKey } from './text';
import type { DataIssue, Dataset, FieldKey, MatchType, Row, Sheet, Targeting, Totals } from './types';

export interface BuildOptions {
  /** 客单价：报表里没有订单数时，用“成交金额 ÷ 客单价”估算订单 */
  price?: number | null;
  /** 文件里有多种货币时，只分析这一种 */
  currency?: string | null;
  /** 用于检查日期是否合理（默认当前时间） */
  today?: Date;
}

const NUMERIC_FIELDS = ['impressions', 'clicks', 'spend', 'orders', 'sales', 'engagements'] as const;
type NumericField = (typeof NUMERIC_FIELDS)[number];

// 整个单元格就是“合计/Total”才算合计行；“total gym accessories”这类搜索词不能误删
const TOTAL_RE = /^(合计|总计|汇总|小计|总和|全部|total|totals|grand ?total|summary|sum)\s*[:：]?$/i;
const PLACEHOLDER = new Set(['-', '--', '---', '—', '——', 'n/a', 'na', 'null', 'none', '/', '\\']);
const COUNT_FIELDS = new Set(['impressions', 'clicks', 'orders', 'engagements']);
const KEY_SEP = '␟';

export function normalizeMatchType(raw: string, targeting: string): MatchType {
  const s = normalizeKey(raw).replace(/\s+/g, '');
  if (['broad', '广泛', '广泛匹配', 'broadmatch'].includes(s)) return 'broad';
  if (['phrase', '词组', '短语', '词组匹配', '短语匹配', 'phrasematch'].includes(s)) return 'phrase';
  if (['exact', '精准', '精确', '精准匹配', '精确匹配', 'exactmatch'].includes(s)) return 'exact';
  const t = normalizeKey(targeting);
  if (/^(close-match|loose-match|substitutes|complements|\*)$/.test(t) || s === 'targeting_expression_predefined') return 'auto';
  if (/^(asin|category|asin-expanded|brand|price|rating)\s*=/.test(t) || s === 'targeting_expression') return 'product';
  return 'unknown';
}

interface ParsedLine {
  fileRow: number;
  term: string;
  isKeyword: boolean;
  campaign: string;
  adGroup: string;
  targeting: string;
  matchType: string;
  unitName: string;
  date: string | null;
  start: string | null;
  end: string | null;
  currency: string | null;
  nums: Record<NumericField, number | null>;
  totalsByText: boolean;
  emptyIdentity: boolean;
}

export function buildDataset(sheet: Sheet, det: Detection, opts: BuildOptions = {}): Dataset {
  const issues: DataIssue[] = [];
  const m = det.mapping;
  const preset = det.preset;
  const isTerm = preset.kind === 'searchTerm';
  const dataRows = sheet.rows.slice(det.headerRow + 1);
  const fileRowOf = (i: number) => sheet.rowOffset + det.headerRow + 1 + i + 1;
  const col = (f: FieldKey) => m[f];

  // 小数分隔符按整份文件判断：花费列出现 "12,50" 这种欧洲写法，点击列的 "1.523" 就是千分位
  const styles: Partial<Record<NumericField, DecimalStyle>> = {};
  for (const f of NUMERIC_FIELDS) {
    const c = col(f);
    if (c !== undefined) styles[f] = inferDecimalStyle(dataRows.map((r) => r?.[c]));
  }
  if (Object.values(styles).includes('comma')) for (const f of Object.keys(styles) as NumericField[]) styles[f] = 'comma';
  const dateOrders: Partial<Record<'date' | 'startDate' | 'endDate', DateOrder>> = {};
  for (const f of ['date', 'startDate', 'endDate'] as const) {
    const c = col(f);
    if (c !== undefined) dateOrders[f] = inferDateOrder(dataRows.map((r) => r?.[c]));
  }

  const invalid: { row: number; header: string; value: string }[] = [];
  const parsed: ParsedLine[] = [];

  dataRows.forEach((r, i) => {
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === '')) return;
    const raw = (f: FieldKey) => {
      const c = col(f);
      return c === undefined ? undefined : r[c];
    };
    const text = (f: FieldKey) => {
      const t = cleanText(raw(f));
      return PLACEHOLDER.has(t.toLowerCase()) ? '' : t;
    };
    const nums = {} as Record<NumericField, number | null>;
    for (const f of NUMERIC_FIELDS) {
      if (col(f) === undefined) {
        nums[f] = null;
        continue;
      }
      const p = COUNT_FIELDS.has(f) ? parseCount(raw(f), styles[f]) : parseNumber(raw(f), styles[f]);
      if (p.invalid) invalid.push({ row: fileRowOf(i), header: det.headers[col(f)!] ?? f, value: String(raw(f)) });
      nums[f] = p.value;
    }
    const searchTerm = text('term');
    const term = searchTerm || text('keyword');
    const campaign = text('campaign');
    const adGroup = text('adGroup');
    const unitName = text('unitName');
    const identity = isTerm ? term : unitName || campaign;
    // 合计标记可能出现在任何维度列或前三列里（如 ['合计', '-', '-', …]）
    const totalsByText = [term, campaign, adGroup, unitName, cleanText(r[0]), cleanText(r[1]), cleanText(r[2])].some((t) => TOTAL_RE.test(t));
    parsed.push({
      fileRow: fileRowOf(i),
      term,
      isKeyword: isTerm && !searchTerm && term !== '',
      campaign,
      adGroup,
      targeting: text('targeting') || text('keyword'),
      matchType: text('matchType'),
      unitName,
      date: col('date') !== undefined ? parseDate(raw('date'), dateOrders.date) : null,
      start: col('startDate') !== undefined ? parseDate(raw('startDate'), dateOrders.startDate) : null,
      end: col('endDate') !== undefined ? parseDate(raw('endDate'), dateOrders.endDate) : null,
      currency: text('currency').toUpperCase() || detectCurrency(raw('spend')) || detectCurrency(raw('sales')),
      nums,
      totalsByText,
      emptyIdentity: identity === '',
    });
  });
  const rawRowCount = parsed.length;

  // —— 排除合计行 ——
  const excludedRows: { row: number; reason: string }[] = [];
  let lines = parsed.filter((p) => {
    if (p.totalsByText) {
      excludedRows.push({ row: p.fileRow, reason: '合计/总计行' });
      return false;
    }
    return true;
  });
  // 数值等于其余各行之和的行，也是合计行（有的导出不写“合计”二字）。
  // 要求所有已识别的数值列同时吻合，避免把恰好等于其他行之和的正常行误删。
  const sum = (arr: ParsedLine[], f: NumericField) => arr.reduce((s, p) => s + (p.nums[f] ?? 0), 0);
  const checkFields = NUMERIC_FIELDS.filter((f) => col(f) !== undefined);
  for (let pass = 0; pass < 3 && lines.length > 2; pass++) {
    const totalsAll = Object.fromEntries(checkFields.map((f) => [f, sum(lines, f)])) as Record<NumericField, number>;
    const candidates = new Set<ParsedLine>([
      ...lines.slice(0, 2),
      ...lines.slice(-3),
      ...lines.filter((p) => p.emptyIdentity),
    ]);
    let removed: ParsedLine | null = null;
    for (const p of candidates) {
      if ((p.nums.spend ?? 0) <= 0) continue;
      // 合计行里留空的列不比较，但至少要有花费在内的两列同时吻合
      const compared = checkFields.filter((f) => p.nums[f] !== null);
      if (compared.length < 2) continue;
      const allMatch = compared.every((f) => {
        const v = p.nums[f] ?? 0;
        const rest = totalsAll[f] - v;
        const tol = f === 'spend' || f === 'sales' ? Math.max(0.011, Math.abs(rest) * 0.002) : Math.max(0.5, Math.abs(rest) * 0.002);
        return Math.abs(v - rest) <= tol;
      });
      if (allMatch) {
        removed = p;
        break;
      }
    }
    if (!removed) break;
    excludedRows.push({ row: removed.fileRow, reason: '数值等于其余各行之和（合计行）' });
    lines = lines.filter((p) => p !== removed);
  }

  // —— 缺少维度的行 ——
  let noIdentity = 0;
  let starTerms = 0;
  lines = lines.filter((p) => {
    if (p.emptyIdentity) {
      noIdentity++;
      excludedRows.push({ row: p.fileRow, reason: isTerm ? '缺少搜索词' : '缺少计划/素材名称' });
      return false;
    }
    if (isTerm && p.term === '*') {
      starTerms++;
      excludedRows.push({ row: p.fileRow, reason: '没有具体搜索词（*）' });
      return false;
    }
    return true;
  });

  // —— 货币 ——
  const currencies: Record<string, number> = {};
  for (const p of lines) if (p.currency) currencies[p.currency] = (currencies[p.currency] ?? 0) + 1;
  const currencyList = Object.entries(currencies).sort((a, b) => b[1] - a[1]);
  let currency: string | null = currencyList[0]?.[0] ?? null;
  if (opts.currency && currencies[opts.currency]) currency = opts.currency;
  if (currencyList.length > 1) {
    const before = lines.length;
    lines = lines.filter((p) => !p.currency || p.currency === currency);
    issues.push({
      level: 'warn',
      code: 'multiCurrency',
      message: `文件里有多种货币（${currencyList.map(([c, n]) => `${c} ${n} 行`).join('、')}），本次只分析 ${currency}，另外 ${before - lines.length} 行未计入。建议按站点分别导出。`,
    });
  }

  // —— 汇总（按天拆分的数据合并成一行）——
  const groups = new Map<string, Row>();
  const targetingSeen = new Map<string, Set<string>>();
  let negatives = 0;
  let clicksOverImpr = 0;
  let ordersOverClicks = 0;
  for (const p of lines) {
    for (const f of NUMERIC_FIELDS) if ((p.nums[f] ?? 0) < 0) negatives++;
    const { impressions, clicks, orders } = p.nums;
    if (impressions !== null && clicks !== null && impressions > 0 && clicks > impressions) clicksOverImpr++;
    if (clicks !== null && orders !== null && orders > clicks && clicks > 0) ordersOverClicks++;

    const name = isTerm ? p.term : p.unitName || p.campaign;
    const key = isTerm
      ? [normalizeKey(p.campaign), normalizeKey(p.adGroup), normalizeKey(p.term)].join(KEY_SEP)
      : [normalizeKey(p.unitName ? p.campaign : ''), normalizeKey(name)].join(KEY_SEP);
    let row = groups.get(key);
    if (!row) {
      row = {
        key,
        name,
        term: isTerm ? p.term : undefined,
        isKeyword: p.isKeyword,
        campaign: p.campaign || undefined,
        adGroup: p.adGroup || undefined,
        targetings: [],
        impressions: col('impressions') !== undefined ? 0 : null,
        clicks: col('clicks') !== undefined ? 0 : null,
        spend: 0,
        orders: 0,
        sales: 0,
        engagements: 0,
        ordersEstimated: false,
        sourceRows: [],
      };
      groups.set(key, row);
      targetingSeen.set(key, new Set());
    }
    if (row.impressions !== null) row.impressions += p.nums.impressions ?? 0;
    if (row.clicks !== null) row.clicks += p.nums.clicks ?? 0;
    row.spend += p.nums.spend ?? 0;
    row.orders += p.nums.orders ?? 0;
    row.sales += p.nums.sales ?? 0;
    row.engagements += p.nums.engagements ?? 0;
    row.sourceRows.push(p.fileRow);
    if (isTerm && (p.targeting || p.matchType)) {
      const t: Targeting = { text: p.targeting, matchType: normalizeMatchType(p.matchType, p.targeting) };
      const tk = `${normalizeKey(t.text)}|${t.matchType}`;
      const seen = targetingSeen.get(key)!;
      if (!seen.has(tk)) {
        seen.add(tk);
        row.targetings.push(t);
      }
    }
  }
  const rows = [...groups.values()].map(roundRow);

  // —— 缺少订单数时按客单价估算 ——
  const hasOrders = col('orders') !== undefined;
  const hasSales = col('sales') !== undefined;
  if (preset.conversion === 'orders' && !hasOrders) {
    if (hasSales && opts.price && opts.price > 0) {
      for (const r of rows) {
        // 有成交金额就至少 1 单，避免把“有成交”估成“0 单”
        r.orders = r.sales > 0 ? Math.max(1, Math.round(r.sales / opts.price!)) : 0;
        r.ordersEstimated = true;
      }
      issues.push({
        level: 'warn',
        code: 'ordersEstimated',
        message: `报表里没有订单数，已按“成交金额 ÷ 客单价 ${opts.price}”估算订单数。结论的可靠性会低一些。`,
      });
    } else {
      issues.push({
        level: 'error',
        code: 'needOrders',
        message: '报表里没有识别到订单数。请在列映射里指定订单数列；如果确实没有，请在成本信息里填写客单价，用来估算订单数。',
      });
    }
  }

  // —— 周期 ——
  const dates = lines.map((p) => p.date).filter((d): d is string => !!d);
  const starts = lines.map((p) => p.start).filter((d): d is string => !!d);
  const ends = lines.map((p) => p.end).filter((d): d is string => !!d);
  let period: Dataset['period'] = null;
  const minOf = (a: string[]) => a.reduce((x, y) => (y < x ? y : x));
  const maxOf = (a: string[]) => a.reduce((x, y) => (y > x ? y : x));
  if (dates.length) period = { start: minOf(dates), end: maxOf(dates), days: 0 };
  else if (starts.length && ends.length) period = { start: minOf(starts), end: maxOf(ends), days: 0 };
  if (period) {
    period.days = Math.max(1, daysBetween(period.start, period.end));
    const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    if (period.end > tomorrow || period.days > 400) {
      issues.push({
        level: 'warn',
        code: 'badPeriod',
        message: `日期识别结果是 ${period.start} 至 ${period.end}，不太合理，可能是日期格式没识别对。本次不按日期折算每月金额，也不做归因延迟提醒。`,
      });
      period = null;
    }
  }

  // —— 数据质量提示 ——
  if (invalid.length) {
    const share = invalid.length / Math.max(1, rawRowCount);
    const ex = invalid.slice(0, 3).map((x) => `第 ${x.row} 行「${x.header}」= "${x.value}"`).join('；');
    issues.push({
      level: share > 0.05 ? 'error' : 'warn',
      code: 'invalidNumbers',
      message: `有 ${invalid.length} 个单元格不是有效数字，已按空值处理（例：${ex}）。${share > 0.05 ? '比例较高，请检查列映射是否正确。' : ''}`,
    });
  }
  const totalsExcluded = excludedRows.filter((e) => e.reason.includes('合计'));
  if (totalsExcluded.length) {
    issues.push({
      level: 'info',
      code: 'totalsExcluded',
      message: `已自动排除 ${totalsExcluded.length} 行合计数据（文件第 ${totalsExcluded.map((e) => e.row).join('、')} 行），避免重复计算。`,
    });
  }
  if (noIdentity) issues.push({ level: 'info', code: 'noIdentity', message: `${noIdentity} 行缺少${isTerm ? '搜索词' : '名称'}，未计入。` });
  if (starTerms) issues.push({ level: 'info', code: 'starTerms', message: `${starTerms} 行搜索词显示为“*”（亚马逊未提供具体搜索词），未计入搜索词分析。` });
  if (rows.length < lines.length) {
    issues.push({ level: 'info', code: 'aggregated', message: `按天或重复出现的 ${lines.length} 行，已按${isTerm ? '“广告活动 + 广告组 + 搜索词”' : '名称'}合并为 ${rows.length} 行。` });
  }
  if (negatives) issues.push({ level: 'warn', code: 'negative', message: `有 ${negatives} 个数值是负数，请确认报表是否正常。` });
  if (clicksOverImpr) issues.push({ level: 'warn', code: 'clicksOverImpressions', message: `${clicksOverImpr} 行的点击数大于展示数，可能列映射有误。` });
  if (ordersOverClicks) {
    issues.push({ level: 'info', code: 'ordersOverClicks', message: `${ordersOverClicks} 行的订单数大于点击数。广告归因窗口内一次点击可能带来多个订单，少量出现属正常。` });
  }
  const totals = computeTotals(rows);
  if (rows.length === 0) issues.push({ level: 'error', code: 'noRows', message: '没有可以分析的数据行，请确认上传的是正确的报表。' });
  else if (totals.spend <= 0) issues.push({ level: 'error', code: 'noSpend', message: '报表里的花费合计为 0，无法诊断。请检查花费列是否识别正确。' });
  if (isTerm && totals.clicks !== null && totals.clicks === 0 && rows.length > 0) {
    issues.push({ level: 'error', code: 'noClicks', message: '报表里的点击合计为 0，无法诊断。' });
  }

  return {
    presetId: preset.id,
    rows,
    totals,
    issues,
    currency,
    currencies,
    period,
    rawRowCount,
    excludedRows,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function roundRow(r: Row): Row {
  return { ...r, spend: round2(r.spend), sales: round2(r.sales) };
}

export function computeTotals(rows: Row[]): Totals {
  const t: Totals = { impressions: null, clicks: null, spend: 0, orders: 0, sales: 0, engagements: 0 };
  for (const r of rows) {
    if (r.impressions !== null) t.impressions = (t.impressions ?? 0) + r.impressions;
    if (r.clicks !== null) t.clicks = (t.clicks ?? 0) + r.clicks;
    t.spend += r.spend;
    t.orders += r.orders;
    t.sales += r.sales;
    t.engagements += r.engagements;
  }
  t.spend = round2(t.spend);
  t.sales = round2(t.sales);
  return t;
}
