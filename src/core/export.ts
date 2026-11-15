/**
 * 导出：操作清单、否定词清单、给 AI 的判断提示词。
 * CSV 带 UTF-8 BOM，Windows 版 Excel 打开中文不乱码；
 * 单元格以 = + - @ 开头时加单引号前缀，防止搜索词里的“公式”在 Excel 里被执行（CSV 注入）。
 */
import { money, pct, ratio } from './format';
import type { Report } from './report';
import type { RowResult, Tier } from './types';

export const TIER_LABEL: Record<Tier, string> = {
  loss: '确定低效',
  suspect: '疑似低效',
  win: '表现优秀',
  insufficient: '数据不足',
  ok: '正常',
  untested: '未判断',
};

export function csvCell(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v === null || v === undefined ? '' : String(v);
  // 开头（含开头的空白、零宽字符之后）是公式符号时加 ' 前缀
  if (/^[\s\u200b-\u200f\u2060\ufeff]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = `'${s}`;
  // 含分号、制表符时也加引号：欧洲地区的 Excel 用分号分列，不加引号时中间的“=…”会变成公式
  if (/[",;\t\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function efficiencyText(report: Report, r: RowResult): string {
  if (report.preset.conversion === 'engagements') return money(r.evidence.efficiency, report.symbol);
  const acos = r.evidence.efficiency;
  if (acos === null) return '—';
  return report.platform === 'amazon' ? pct(acos) : ratio(1 / acos);
}

export function actionsCsv(report: Report): string {
  const isTerm = report.preset.kind === 'searchTerm';
  const isOrders = report.preset.conversion === 'orders';
  const effLabel = !isOrders ? '互动成本' : report.platform === 'amazon' ? 'ACoS' : 'ROI';
  const header = [
    '结论',
    isTerm ? '搜索词' : '名称',
    '广告活动/计划',
    '广告组/单元',
    '点击',
    isOrders ? '订单' : '互动',
    '花费',
    '销售额',
    effLabel,
    '建议操作',
    '建议说明',
    '依据',
    '原始行号',
  ];
  const rows = report.results.map((r) => [
    TIER_LABEL[r.tier],
    r.row.name,
    r.row.campaign ?? '',
    r.row.adGroup ?? '',
    r.row.clicks ?? '',
    isOrders ? r.row.orders : r.row.engagements,
    r.row.spend,
    r.row.sales,
    efficiencyText(report, r),
    r.action.text,
    r.action.detail ?? '',
    r.explanation,
    r.row.sourceRows.slice(0, 20).join(' '),
  ]);
  return toCsv([header, ...rows]);
}

export function negativesCsv(report: Report): string {
  const amazon = report.platform === 'amazon';
  const header = amazon
    ? ['广告活动', '广告组', '否定内容', '否定类型', '花费', '点击', '订单', '依据']
    : ['计划', '单元', '否定词', '类型', '花费', '点击', '订单', '依据'];
  const rows: unknown[][] = [];
  for (const r of report.results) {
    const action = r.action;
    if (action.code !== 'negate' && action.code !== 'negateAsin') continue;
    const type = action.code === 'negateAsin' ? '否定商品投放（ASIN）' : amazon ? '否定精准' : '否定词（精准）';
    rows.push([r.row.campaign ?? '', r.row.adGroup ?? '', r.row.name, type, r.row.spend, r.row.clicks ?? '', r.row.orders, r.explanation]);
  }
  for (const root of report.roots) {
    if (root.cautious) continue;
    rows.push([
      '（多个广告活动）',
      '',
      root.token,
      amazon ? '否定词组（请人工确认）' : '否定词（短语，请人工确认）',
      root.spend,
      root.clicks,
      root.orders,
      `出现在 ${root.termCount} 个搜索词中，例如：${root.examples.join('、')}`,
    ]);
  }
  return toCsv([header, ...rows]);
}

/**
 * 生成给 DeepSeek / Kimi / ChatGPT 的提示词：让 AI 只做“这个搜索词和我的产品相关吗”这一件事。
 * 数字判断已经由统计完成，AI 不参与算数。
 */
export function aiPrompt(report: Report, productText: string, limit = 120): string {
  const candidates = report.results
    .filter((r) => r.row.term && (r.tier === 'loss' || r.tier === 'suspect') && r.row.orders === 0)
    .slice(0, limit);
  const lines = candidates.map((r, i) => `${i + 1}. ${r.row.name}（点击 ${r.row.clicks ?? '—'}，花费 ${money(r.row.spend, report.symbol)}，0 单）`);
  const product = productText.trim() || '（请在这里粘贴你的产品标题和卖点描述）';
  return [
    '你是一名资深电商广告运营。下面这些广告搜索词已经花了钱但没有出单。请逐个判断它们和我的产品是否相关，只做相关性判断，不需要重新计算数字。',
    '',
    '【我的产品】',
    product,
    '',
    '【待判断的搜索词】',
    ...(lines.length ? lines : ['（本次没有需要判断的搜索词）']),
    '',
    '【输出要求】',
    '用表格输出，列为：序号、搜索词、判断、理由（一句话）。判断只能从下面四个选项里选：',
    '- 不相关：买家要的不是我这类产品，可以否定',
    '- 竞品品牌词：搜的是其他品牌，是否否定取决于我的竞品策略',
    '- 相关但没转化：买家要的就是我这类产品，问题可能在价格、图片或评价，不要否定',
    '- 不确定：信息不足，需要我人工看',
    '拿不准时选“不确定”，不要猜。',
  ].join('\n');
}
