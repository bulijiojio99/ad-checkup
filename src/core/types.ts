/** 核心类型定义：与平台无关，网页版、命令行版、插件版共用。 */

export type PlatformId = 'amazon' | 'douyin' | 'xiaohongshu';

/** searchTerm：一行一个搜索词（决定否定/调价）；unit：一行一个计划/单元/素材/笔记（决定放量/止损） */
export type ReportKind = 'searchTerm' | 'unit';

/** 统计检验用的“转化”：电商看订单；种草类笔记看互动 */
export type ConversionKind = 'orders' | 'engagements';

export type Cell = string | number | boolean | null | undefined;

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** rows[0] 对应文件里的第几行（从 0 开始），用于把结果映射回原始行号 */
  rowOffset: number;
  /** 文本文件识别出的编码 */
  encoding?: string;
}

export type FieldKey =
  | 'term'
  | 'keyword'
  | 'campaign'
  | 'adGroup'
  | 'targeting'
  | 'matchType'
  | 'unitName'
  | 'impressions'
  | 'clicks'
  | 'spend'
  | 'orders'
  | 'sales'
  | 'engagements'
  | 'date'
  | 'startDate'
  | 'endDate'
  | 'currency';

export type FieldType = 'text' | 'number' | 'date';

export interface FieldSpec {
  key: FieldKey;
  /** 界面上显示的中文名 */
  label: string;
  type: FieldType;
  /** 表头别名，归一化后精确匹配，靠前的优先 */
  aliases: string[];
  /** 归一化表头上的正则，用于“7 Day / 14 Day”这类会变的写法 */
  patterns?: RegExp[];
}

export interface ReportPreset {
  id: string;
  platform: PlatformId;
  kind: ReportKind;
  conversion: ConversionKind;
  name: string;
  /** 在后台哪里导出 */
  exportHint: string;
  /** 表头是否已经用真实导出文件核实过 */
  verified: boolean;
  fields: FieldSpec[];
  /** 外层是“且”，内层是“或”：每组至少要识别到一列 */
  required: FieldKey[][];
}

export type MatchType = 'broad' | 'phrase' | 'exact' | 'auto' | 'product' | 'unknown';

export interface Targeting {
  text: string;
  matchType: MatchType;
}

/** 归一化、按维度汇总后的一行数据 */
export interface Row {
  key: string;
  /** 展示名：搜索词或计划/素材名 */
  name: string;
  term?: string;
  /** 报表里只有“关键词”（广告主自己买的词），没有买家搜索词 */
  isKeyword?: boolean;
  campaign?: string;
  adGroup?: string;
  targetings: Targeting[];
  impressions: number | null;
  clicks: number | null;
  spend: number;
  orders: number;
  sales: number;
  engagements: number;
  ordersEstimated: boolean;
  /** 文件中的原始行号（从 1 开始，含表头之前的行），方便卖家回查 */
  sourceRows: number[];
}

export type IssueLevel = 'error' | 'warn' | 'info';

export interface DataIssue {
  level: IssueLevel;
  code: string;
  message: string;
}

export interface Totals {
  impressions: number | null;
  clicks: number | null;
  spend: number;
  orders: number;
  sales: number;
  engagements: number;
}

export interface Dataset {
  presetId: string;
  rows: Row[];
  totals: Totals;
  issues: DataIssue[];
  currency: string | null;
  currencies: Record<string, number>;
  period: { start: string; end: string; days: number } | null;
  /** 原始数据行数（排除表头、空行、合计行之前） */
  rawRowCount: number;
  excludedRows: { row: number; reason: string }[];
}

export type Tier = 'loss' | 'suspect' | 'win' | 'insufficient' | 'ok' | 'untested';

export interface Evidence {
  method: 'binomial' | 'poisson' | 'none';
  /** 每次转化最多可花的广告费（保本或目标线） */
  allowedCostPerConversion: number | null;
  /** 二项检验：保本所需转化率 */
  requiredRate: number | null;
  /** 保本前提下应有的转化数期望 */
  expected: number | null;
  observed: number;
  /** 在“能达到保本线”前提下，观察到这么少（或更少）转化的概率 */
  pLoss: number | null;
  /** 在“刚好保本”前提下，观察到这么多（或更多）转化的概率 */
  pWin: number | null;
  qLoss: number | null;
  qWin: number | null;
  /** 要下结论还需要的点击数或花费 */
  needMoreClicks: number | null;
  needMoreSpend: number | null;
  costPerClick: number | null;
  /** 检验时实际使用的转化率上限（保本所需转化率高得不现实时，按合理上限检验） */
  testedRate: number | null;
  /** 泊松检验的离散度校正系数（互动、成交成串出现时大于 1） */
  dispersion: number | null;
  aov: number | null;
  aovSource: 'row' | 'group' | 'account' | 'price' | null;
  efficiency: number | null;
}

export type ActionCode =
  | 'negate'
  | 'negateAsin'
  | 'pauseKeyword'
  | 'lowerBidRelated'
  | 'lowerBid'
  | 'lowerBidWatch'
  | 'watch'
  | 'harvestExact'
  | 'raiseBid'
  | 'scaleUp'
  | 'cutUnit'
  | 'reviewCompetitor'
  | 'keep'
  | 'none';

export interface Action {
  code: ActionCode;
  /** 表格里的一句话建议 */
  text: string;
  /** 展开后的具体说明：这一行的数字、可能的原因、替代方案和复查条件 */
  detail?: string;
  suggestedBid?: number;
}

export type Relevance = 'related' | 'partial' | 'unrelated';

export interface RowResult {
  row: Row;
  tier: Tier;
  evidence: Evidence;
  action: Action;
  relevance: Relevance | null;
  flags: string[];
  /** 计入“可节省”的金额（只统计 loss 档） */
  saving: number;
  explanation: string;
}
