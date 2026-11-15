import type { ReportPreset } from '../core/types';

/**
 * 亚马逊商品推广（Sponsored Products）搜索词报告。
 * 英文表头参考公开教程（Jungle Scout 等）整理，新版报告中心的 API 风格字段（purchases7d、sales7d）也一并支持。
 * 归因天数不写死：卖家通常是 7 天，供应商可能是 14 天，用正则匹配“N Day Total …”。
 * 中文表头尚未用真实导出文件核对，识别不到时请在界面上手动指定列。
 */
export const amazonSearchTerm: ReportPreset = {
  id: 'amazon-sp-search-term',
  platform: 'amazon',
  kind: 'searchTerm',
  conversion: 'orders',
  name: '商品推广搜索词报告',
  exportHint:
    '广告 → 广告活动管理 → 衡量和报告 → 赞助广告报告 → 创建报告：广告类型选“商品推广”，报告类型选“搜索词”，时间选最近 30–60 天，运行后下载',
  verified: false,
  required: [['term'], ['clicks'], ['spend'], ['orders', 'sales']],
  fields: [
    { key: 'term', label: '客户搜索词', type: 'text', aliases: ['Customer Search Term', 'Search Term', 'searchTerm', 'search_term', '客户搜索词', '客户搜索关键词', '顾客搜索词', '买家搜索词', '搜索词'] },
    { key: 'campaign', label: '广告活动', type: 'text', aliases: ['Campaign Name', 'Campaign', 'campaignName', 'campaign_name', '广告活动名称', '广告活动'] },
    { key: 'adGroup', label: '广告组', type: 'text', aliases: ['Ad Group Name', 'Ad Group', 'adGroupName', 'ad_group_name', '广告组名称', '广告组'] },
    { key: 'targeting', label: '投放（关键词或商品）', type: 'text', aliases: ['Targeting', 'targeting', 'Keyword', 'keyword', 'Keyword Text', '投放', '投放对象', '关键词', '定向'] },
    { key: 'matchType', label: '匹配类型', type: 'text', aliases: ['Match Type', 'matchType', 'match_type', '匹配类型', '匹配方式'] },
    { key: 'impressions', label: '展示量', type: 'number', aliases: ['Impressions', 'impressions', '展示量', '展示次数', '曝光量'] },
    { key: 'clicks', label: '点击量', type: 'number', aliases: ['Clicks', 'clicks', '点击量', '点击次数', '点击'] },
    { key: 'spend', label: '花费', type: 'number', aliases: ['Spend', 'Cost', 'spend', 'cost', '花费', '广告花费', '支出'] },
    {
      key: 'orders',
      label: '订单数',
      type: 'number',
      aliases: ['purchases7d', 'purchases14d', 'Purchases', '7天总订单数', '14天总订单数', '总订单数', '订单数', '订单量', 'Orders'],
      patterns: [/^(\d+)daytotalorders$/, /^(\d+)天总订单数?$/, /^purchases(\d+)d$/],
    },
    {
      key: 'sales',
      label: '销售额',
      type: 'number',
      aliases: ['sales7d', 'sales14d', 'Sales', '7天总销售额', '14天总销售额', '总销售额', '销售额'],
      patterns: [/^(\d+)daytotalsales$/, /^(\d+)天总销售额$/, /^sales(\d+)d$/],
    },
    { key: 'date', label: '日期', type: 'date', aliases: ['Date', 'date', '日期'] },
    { key: 'startDate', label: '开始日期', type: 'date', aliases: ['Start Date', 'startDate', '开始日期'] },
    { key: 'endDate', label: '结束日期', type: 'date', aliases: ['End Date', 'endDate', '结束日期'] },
    { key: 'currency', label: '货币', type: 'text', aliases: ['Currency', 'currency', '货币', '币种'] },
  ],
};

export const amazonPresets: ReportPreset[] = [amazonSearchTerm];
