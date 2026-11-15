import type { FieldSpec, ReportPreset } from '../core/types';

/**
 * 抖音电商 · 巨量千川。
 * 2026 年调研结论：全域推广是主流，搜索广告仍有关键词和搜索词报表；官方帮助中心需要登录，
 * 没能拿到真实导出文件，下面的列名来自官方帮助页和运营教程里的指标名，属于“测试版”，
 * 识别结果必须让用户核对列映射。
 * 口径备注：净成交金额 = 整体成交金额 − 支付后 1 小时内的秒退单，之后的退款不扣。
 */

const metrics: FieldSpec[] = [
  { key: 'impressions', label: '展示次数', type: 'number', aliases: ['展示次数', '整体展示次数', '展示数', '展现次数', '展示量', '曝光次数', '曝光量'] },
  { key: 'clicks', label: '点击次数', type: 'number', aliases: ['点击次数', '整体点击次数', '点击数', '点击量'] },
  { key: 'spend', label: '消耗', type: 'number', aliases: ['消耗', '整体消耗', '花费', '总消耗', '消耗金额'] },
  {
    key: 'orders',
    label: '成交订单数',
    type: 'number',
    aliases: ['整体成交订单数', '成交订单数', '直接成交订单数', '7日总成交订单数', '支付订单数', '成交订单量', '订单数', '转化数'],
  },
  {
    key: 'sales',
    label: '成交金额',
    type: 'number',
    aliases: ['整体成交金额', '成交金额', '直接成交金额', '7日总成交金额', '净成交金额', '整体支付金额', '支付金额', 'GMV'],
  },
  { key: 'date', label: '日期', type: 'date', aliases: ['日期', '时间', '统计日期', '数据日期'] },
];

export const douyinSearchTerm: ReportPreset = {
  id: 'douyin-qianchuan-search-term',
  platform: 'douyin',
  kind: 'searchTerm',
  conversion: 'orders',
  name: '千川搜索词 / 关键词报表',
  exportHint: '巨量千川 → 数据 → 搜索广告相关报表（直播或短视频下的“搜索词”或“关键词”）→ 下载数据表格。词汇数据约保留 1 个月，建议导出最近 14–30 天',
  verified: false,
  required: [['term', 'keyword'], ['clicks'], ['spend'], ['orders', 'sales']],
  fields: [
    { key: 'term', label: '搜索词', type: 'text', aliases: ['搜索词', '用户搜索词', '搜索关键词'] },
    { key: 'keyword', label: '关键词', type: 'text', aliases: ['关键词', '购买关键词', '投放关键词', '关键词名称'] },
    { key: 'campaign', label: '计划', type: 'text', aliases: ['计划名称', '计划', '广告计划', '计划名'] },
    { key: 'adGroup', label: '单元', type: 'text', aliases: ['单元名称', '单元'] },
    { key: 'matchType', label: '匹配类型', type: 'text', aliases: ['匹配类型', '匹配方式'] },
    ...metrics,
  ],
};

export const douyinUnit: ReportPreset = {
  id: 'douyin-qianchuan-unit',
  platform: 'douyin',
  kind: 'unit',
  conversion: 'orders',
  name: '千川计划 / 素材 / 商品报表',
  exportHint: '巨量千川 → 数据 → 全域推广数据（或标准推广数据）→ 选择计划、素材或商品维度 → 下载数据表格。建议导出最近 7–30 天',
  verified: false,
  required: [['unitName', 'campaign'], ['spend'], ['orders', 'sales']],
  fields: [
    {
      key: 'unitName',
      label: '素材 / 商品 / 计划名称',
      type: 'text',
      aliases: ['素材名称', '视频名称', '视频标题', '素材标题', '创意名称', '素材ID', '视频ID', '创意ID', '商品名称', '商品ID', '计划名称', '计划ID'],
    },
    { key: 'campaign', label: '所属计划', type: 'text', aliases: ['计划名称', '所属计划', '计划'] },
    ...metrics,
  ],
};

export const douyinPresets: ReportPreset[] = [douyinSearchTerm, douyinUnit];
