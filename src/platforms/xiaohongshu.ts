import type { FieldSpec, ReportPreset } from '../core/types';

/**
 * 小红书。2026 年调研结论：聚光（种草、搜索、信息流）和乘风（电商：商品推广、直播推广）并存，
 * 做电商的商家主要用乘风。官方帮助中心需要登录，没能拿到真实导出文件；
 * 下面的列名来自培训资料和教程里的指标名，属于“测试版”，识别结果必须让用户核对。
 * 口径备注：“7日支付ROI”包含 7 天内二次触达的成交，可能偏高；聚光是否支持否定词、有没有搜索词报表未能核实。
 */

const traffic: FieldSpec[] = [
  { key: 'impressions', label: '展现量', type: 'number', aliases: ['展现量', '展现', '曝光量', '展示量', '曝光数'] },
  { key: 'clicks', label: '点击量', type: 'number', aliases: ['点击量', '点击', '点击次数', '点击数'] },
  { key: 'spend', label: '消费', type: 'number', aliases: ['消费', '花费', '消耗', '消费金额', '总消费'] },
  { key: 'date', label: '日期', type: 'date', aliases: ['日期', '时间', '统计日期'] },
];

const commerce: FieldSpec[] = [
  {
    key: 'orders',
    label: '支付订单数',
    type: 'number',
    aliases: ['支付订单数', '7日支付订单数', '支付订单量', '成交订单数', '订单数', '商品成交订单数'],
  },
  { key: 'sales', label: '支付金额', type: 'number', aliases: ['支付金额', '7日支付金额', '成交金额', '支付GMV', 'GMV'] },
];

const engagement: FieldSpec = { key: 'engagements', label: '互动量', type: 'number', aliases: ['互动量', '互动数', '互动', '总互动'] };

export const xhsSearchTerm: ReportPreset = {
  id: 'xhs-search-term',
  platform: 'xiaohongshu',
  kind: 'searchTerm',
  conversion: 'orders',
  name: '搜索推广关键词 / 搜索词报表（电商）',
  exportHint: '聚光或乘风 → 数据报表 → 按关键词（或搜索词）维度 → 下载报表。建议导出最近 14–30 天',
  verified: false,
  required: [['term', 'keyword'], ['clicks'], ['spend'], ['orders', 'sales']],
  fields: [
    { key: 'term', label: '搜索词', type: 'text', aliases: ['搜索词', '用户搜索词'] },
    { key: 'keyword', label: '关键词', type: 'text', aliases: ['关键词', '购买关键词', '投放关键词'] },
    { key: 'campaign', label: '计划', type: 'text', aliases: ['计划名称', '计划'] },
    { key: 'adGroup', label: '单元', type: 'text', aliases: ['单元名称', '单元'] },
    { key: 'matchType', label: '匹配类型', type: 'text', aliases: ['匹配类型', '匹配方式'] },
    ...traffic,
    ...commerce,
    engagement,
  ],
};

export const xhsUnitCommerce: ReportPreset = {
  id: 'xhs-unit-commerce',
  platform: 'xiaohongshu',
  kind: 'unit',
  conversion: 'orders',
  name: '乘风 / 聚光计划或笔记报表（电商）',
  exportHint: '乘风（或聚光）→ 数据报表 → 选择计划、单元或笔记维度，自定义列勾选支付订单数和支付金额 → 下载报表',
  verified: false,
  required: [['unitName', 'campaign'], ['spend'], ['orders', 'sales']],
  fields: [
    {
      key: 'unitName',
      label: '笔记 / 商品 / 计划名称',
      type: 'text',
      aliases: ['笔记标题', '笔记名称', '创意名称', '笔记ID', '创意ID', '商品名称', '商品ID', '单元名称', '单元ID', '计划名称', '计划ID'],
    },
    { key: 'campaign', label: '所属计划', type: 'text', aliases: ['计划名称', '所属计划', '计划'] },
    ...traffic,
    ...commerce,
    engagement,
  ],
};

export const xhsUnitEngagement: ReportPreset = {
  id: 'xhs-unit-engagement',
  platform: 'xiaohongshu',
  kind: 'unit',
  conversion: 'engagements',
  name: '聚光笔记种草报表（按互动诊断）',
  exportHint: '聚光 → 数据报表 → 选择笔记（创意）维度 → 下载报表。适合没有成交数据的种草投放',
  verified: false,
  required: [['unitName', 'campaign'], ['spend'], ['engagements']],
  fields: [
    {
      key: 'unitName',
      label: '笔记名称',
      type: 'text',
      aliases: ['笔记标题', '笔记名称', '创意名称', '笔记ID', '创意ID', '单元名称', '单元ID', '计划名称', '计划ID'],
    },
    { key: 'campaign', label: '所属计划', type: 'text', aliases: ['计划名称', '所属计划', '计划'] },
    ...traffic,
    engagement,
  ],
};

export const xhsPresets: ReportPreset[] = [xhsSearchTerm, xhsUnitCommerce, xhsUnitEngagement];
