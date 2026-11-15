/**
 * 建议文案的约束：说法要留余地、要具体到这一行，而且方向不能写反。
 */
import { describe, expect, it } from 'vitest';
import { actionsCsv } from '../src/core/export';
import { detectForPlatform, prepareDataset, runDiagnosis } from '../src/core/pipeline';
import type { Report, TargetInput } from '../src/core/report';
import { normalizeKey } from '../src/core/text';
import { SAMPLES, type Sample } from '../src/samples/generate';

const TODAY = new Date('2026-11-15T00:00:00Z');

function targetOf(s: Sample): TargetInput {
  if (s.amazonCosts) return { type: 'amazonCosts', costs: s.amazonCosts };
  if (s.domesticCosts) return { type: 'domesticCosts', costs: s.domesticCosts };
  return { type: 'auto' };
}

function reportOf(id: string): Report {
  const s = SAMPLES[id]!();
  const sheets = [{ name: 'x', rows: s.rows, rowOffset: 0 }];
  const det = detectForPlatform(sheets, s.platform)!;
  const price = s.amazonCosts?.price ?? s.domesticCosts?.price;
  const ds = prepareDataset(sheets, det, { price });
  const res = runDiagnosis({ platform: s.platform, detection: det, dataset: ds, target: targetOf(s), productText: s.product, price, today: TODAY });
  if (!res.ok) throw new Error(res.error);
  return res.report;
}

function row(report: Report, name: string) {
  const r = report.results.find((x) => normalizeKey(x.row.name) === normalizeKey(name));
  if (!r) throw new Error(`row not found: ${name}`);
  return r;
}

const ABSOLUTE = /必须|一定要|肯定|绝对|务必|立即|马上|直接暂停|直接否定|毫无疑问|不要整体否定/;
const reports = Object.keys(SAMPLES).map((id) => [id, reportOf(id)] as const);

describe('建议文案', () => {
  it.each(reports)('%s：不使用绝对化的说法', (_id, report) => {
    for (const r of report.results) {
      expect(r.action.text).not.toMatch(ABSOLUTE);
      expect(r.action.detail ?? '').not.toMatch(ABSOLUTE);
    }
    for (const root of report.roots) expect(root.advice).not.toMatch(ABSOLUTE);
  });

  it.each(reports)('%s：需要调整的行都附上了说明', (_id, report) => {
    for (const r of report.results) {
      if (r.tier === 'loss' || r.tier === 'suspect' || r.tier === 'win') expect(r.action.detail ?? '').not.toBe('');
    }
  });

  it('否定建议点出不在产品描述里的词，以及触发它的关键词', () => {
    const r = row(reportOf('amazon-st'), 'kids school backpack');
    expect(r.action.code).toBe('negate');
    expect(r.action.text).toContain('school');
    expect(r.action.detail).toContain('backpack');
    expect(r.action.detail).toMatch(/花费 \$[\d.,]+、点击 \d+ 次/);
  });

  it('数据不足时不建议调整，并给出复查时机', () => {
    const r = row(reportOf('amazon-st'), 'backpack cooler');
    expect(r.tier).toBe('insufficient');
    expect(r.action.text).toContain('暂不建议调整');
    expect(r.action.detail).toMatch(/再积累 \d+ 次点击后复查/);
  });

  it('国内平台 ROI 偏低时写“低于保本线”，亚马逊 ACoS 偏高时写“高于保本线”', () => {
    const dy = row(reportOf('douyin-st'), '蕉下防晒衣');
    expect(dy.action.detail).toMatch(/ROI [\d.]+，低于保本线/);
    expect(dy.action.detail).toContain('商品详情页');
    expect(dy.action.detail).not.toContain('Listing');
    const az = row(reportOf('amazon-st'), 'hiking backpack 65l');
    expect(az.action.detail).toMatch(/ACoS [\d.]+%，高于保本线/);
    for (const [, report] of reports) {
      if (report.platform === 'amazon') continue;
      for (const r of report.results) expect(r.action.detail ?? '').not.toMatch(/ROI [\d.]+，高于/);
    }
  });

  it('词根建议写出覆盖的搜索词数量和花费，并提醒确认', () => {
    const roots = reportOf('amazon-st').roots.filter((x) => !x.cautious);
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      expect(root.advice).toContain(`${root.termCount} 个搜索词`);
      expect(root.advice).toMatch(/花费 \$[\d.,]+/);
      expect(root.advice).toContain('如果它其实是你产品的用途或规格');
    }
  });

  it('属于亏损词根的词，说明里会提到这个词根', () => {
    const report = reportOf('amazon-st');
    const root = report.roots.find((x) => !x.cautious)!;
    const member = report.results.find((r) => root.memberKeys.includes(r.row.key) && (r.tier === 'loss' || r.tier === 'suspect'))!;
    expect(member.action.detail).toContain(`词根“${root.token}”`);
  });

  it('导出的 CSV 有“建议说明”一列', () => {
    const csv = actionsCsv(reportOf('amazon-st'));
    const header = csv.replace(/^﻿/, '').split(/\r?\n/)[0]!;
    expect(header).toContain('建议说明');
    expect(csv).toContain('它由广泛匹配关键词');
  });
});
