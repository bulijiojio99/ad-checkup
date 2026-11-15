/** 网页版、命令行版、测试共用的完整流程。 */
import { PLATFORMS, presetById } from '../platforms';
import { detectReport, type Detection } from './detect';
import { buildDataset, type BuildOptions } from './records';
import { buildReport, resolveTarget, salesIsNet, type Report, type TargetInput } from './report';
import { readTable } from './table';
import type { Dataset, PlatformId, Sheet } from './types';

export { readTable };

export function detectForPlatform(sheets: Sheet[], platform: PlatformId, presetId?: string): Detection | null {
  const presets = presetId ? [presetById(presetId)!].filter(Boolean) : PLATFORMS[platform].presets;
  return detectReport(sheets, presets);
}

export function prepareDataset(sheets: Sheet[], det: Detection, opts: BuildOptions = {}): Dataset {
  const sheet = sheets[det.sheetIndex];
  if (!sheet) throw new Error('找不到工作表');
  return buildDataset(sheet, det, opts);
}

export type RunResult = { ok: true; report: Report } | { ok: false; error: string };

export function runDiagnosis(args: {
  platform: PlatformId;
  detection: Detection;
  dataset: Dataset;
  target: TargetInput;
  productText?: string;
  price?: number | null;
  today?: Date;
}): RunResult {
  const blocking = args.dataset.issues.find((i) => i.level === 'error');
  if (blocking) return { ok: false, error: blocking.message };
  const t = resolveTarget(args.platform, args.detection.preset, args.target, args.dataset, { netSales: salesIsNet(args.detection) });
  if (!t.ok) return t;
  const report = buildReport({
    platform: args.platform,
    preset: args.detection.preset,
    dataset: args.dataset,
    target: t.target,
    productText: args.productText,
    price: args.price,
    today: args.today,
  });
  return { ok: true, report };
}
