/**
 * 命令行版（也是之后 AI 助手插件版调用的脚本）：
 *   node dist-cli/ad-checkup.mjs 报表.csv --platform amazon --price 45.99 --cost 14 --fba 7.2 --referral 15 --product "..."
 *   node dist-cli/ad-checkup.mjs 千川.xlsx --platform douyin --price 89 --cost 28 --shipping 4 --platform-pct 5 --return-rate 35
 * 选项 --json 输出完整 JSON；--csv 和 --negatives 写出操作清单和否定词清单。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { actionsCsv, negativesCsv, TIER_LABEL } from '../core/export';
import { money, pct, ratio } from '../core/format';
import { detectForPlatform, prepareDataset, readTable, runDiagnosis } from '../core/pipeline';
import type { TargetInput } from '../core/report';
import type { PlatformId } from '../core/types';
import { PLATFORMS } from '../platforms';

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function n(flags: Record<string, string | true>, key: string): number | undefined {
  const v = flags[key];
  if (v === undefined || v === true) return undefined;
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(`--${key} 不是有效数字：${v}`);
  return x;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  const platform = (flags.platform as PlatformId) || 'amazon';
  if (!file || flags.help) {
    console.log('用法：ad-checkup <报表文件> --platform amazon|douyin|xiaohongshu [成本参数] [--product 文本] [--json] [--csv 文件] [--negatives 文件]');
    process.exit(file ? 0 : 1);
  }
  if (!PLATFORMS[platform]) throw new Error(`未知平台：${platform}`);
  const meta = PLATFORMS[platform];
  const sheets = await readTable(new Uint8Array(readFileSync(file)), basename(file));
  const det = detectForPlatform(sheets, platform, typeof flags.preset === 'string' ? flags.preset : undefined);
  if (!det) throw new Error('没有识别出报表类型，请确认平台和文件是否正确');
  if (det.missing.length) {
    throw new Error(`缺少必填列：${det.missing.map((g) => g.map((k) => det.preset.fields.find((f) => f.key === k)?.label ?? k).join(' 或 ')).join('；')}`);
  }
  const price = n(flags, 'price');
  const ds = prepareDataset(sheets, det, { price });

  let target: TargetInput = { type: 'auto' };
  if (n(flags, 'target-cpe') !== undefined) target = { type: 'cpe', value: n(flags, 'target-cpe')! };
  else if (n(flags, 'target-acos') !== undefined) target = { type: 'acos', value: n(flags, 'target-acos')! / 100 };
  else if (n(flags, 'target-roi') !== undefined) target = { type: 'roi', value: n(flags, 'target-roi')! };
  else if (price !== undefined && meta.costModel === 'amazon') {
    target = { type: 'amazonCosts', costs: { price, productCost: n(flags, 'cost') ?? 0, fbaFee: n(flags, 'fba') ?? 0, referralPct: n(flags, 'referral') ?? 15, otherCost: n(flags, 'other') ?? 0 } };
  } else if (price !== undefined) {
    const rr = n(flags, 'return-rate');
    if (rr === undefined) throw new Error('国内平台请用 --return-rate 填写退货率（没有退货填 0）');
    target = {
      type: 'domesticCosts',
      costs: { price, productCost: n(flags, 'cost') ?? 0, shipping: n(flags, 'shipping') ?? 0, platformPct: n(flags, 'platform-pct') ?? 0, commissionPct: n(flags, 'commission') ?? 0, returnRatePct: rr },
    };
  }

  const res = runDiagnosis({ platform, detection: det, dataset: ds, target, productText: typeof flags.product === 'string' ? flags.product : undefined, price });
  if (!res.ok) throw new Error(res.error);
  const r = res.report;
  if (typeof flags.csv === 'string') writeFileSync(flags.csv, actionsCsv(r));
  if (typeof flags.negatives === 'string') writeFileSync(flags.negatives, negativesCsv(r));
  if (flags.json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const sym = r.symbol;
  const lines = [
    `# 投流体检：${meta.name} ${r.preset.name}`,
    r.period ? `周期：${r.period.start} 至 ${r.period.end}（${r.period.days} 天）` : '',
    `参照线：${r.target.label}`,
    `总花费 ${money(r.totals.spend, sym)}，${r.platform === 'amazon' ? `整体 ACoS ${pct(r.derived.acos)}` : `整体 ROI ${ratio(r.derived.roi)}`}`,
    `有统计依据的低效花费：${money(r.summary.saving, sym)}（占 ${pct(r.summary.savingShare)}）${r.summary.monthlySaving !== null ? `，折合每月约 ${money(r.summary.monthlySaving, sym, 0)}` : ''}`,
    '',
    ...r.issues.map((i) => `[数据] ${i.message}`),
    ...r.notes.map((x) => `[提示] ${x}`),
    '',
  ];
  for (const tier of ['loss', 'suspect', 'win'] as const) {
    const rows = r.results.filter((x) => x.tier === tier);
    if (!rows.length) continue;
    lines.push(`## ${TIER_LABEL[tier]}（${rows.length}）`);
    for (const x of rows.slice(0, 30)) lines.push(`- ${x.row.name}｜花费 ${money(x.row.spend, sym)}｜${x.action.text}\n  依据：${x.explanation}`);
    lines.push('');
  }
  if (r.roots.length) {
    lines.push(`## 词根（${r.roots.length}）`);
    for (const x of r.roots) lines.push(`- ${x.token}：${x.termCount} 个搜索词，花费 ${money(x.spend, sym)}，${x.advice}`);
  }
  console.log(lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'));
}

main().catch((e) => {
  console.error(`错误：${(e as Error).message}`);
  process.exit(1);
});
