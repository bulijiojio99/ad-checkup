/**
 * 识别报表类型与列映射。
 * 国内平台导出的表格顶部常有标题行、筛选条件说明，所以在前 40 行里找“最像表头”的那一行。
 * 只做归一化后的精确匹配和明确的正则匹配，不做模糊猜测；识别不到的必填列交给用户在界面上手动指定。
 */
import { normalizeHeader } from './text';
import type { Cell, FieldKey, ReportPreset, Sheet } from './types';

export type Mapping = Partial<Record<FieldKey, number>>;

export interface ColumnMatch {
  field: FieldKey;
  column: number;
  header: string;
  via: 'alias' | 'pattern' | 'manual';
}

export interface Detection {
  sheetIndex: number;
  sheetName: string;
  headerRow: number;
  headers: string[];
  preset: ReportPreset;
  mapping: Mapping;
  matches: ColumnMatch[];
  missing: FieldKey[][];
  score: number;
  alternatives: { presetId: string; name: string; score: number; complete: boolean }[];
}

const HEADER_SCAN_ROWS = 40;

const normalizedAliasCache = new WeakMap<ReportPreset, Map<FieldKey, string[]>>();

function aliasesOf(preset: ReportPreset): Map<FieldKey, string[]> {
  let m = normalizedAliasCache.get(preset);
  if (!m) {
    m = new Map();
    for (const f of preset.fields) m.set(f.key, f.aliases.map(normalizeHeader).filter(Boolean));
    normalizedAliasCache.set(preset, m);
  }
  return m;
}

export function matchHeaders(headerCells: Cell[], preset: ReportPreset) {
  const normalized = headerCells.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Mapping = {};
  const matches: ColumnMatch[] = [];
  const aliasMap = aliasesOf(preset);

  // 第一轮：所有字段先用别名精确匹配，避免正则抢走本该精确匹配的列
  for (const field of preset.fields) {
    for (const alias of aliasMap.get(field.key) ?? []) {
      const col = normalized.findIndex((h, i) => h === alias && !used.has(i));
      if (col >= 0) {
        used.add(col);
        mapping[field.key] = col;
        matches.push({ field: field.key, column: col, header: String(headerCells[col] ?? ''), via: 'alias' });
        break;
      }
    }
  }
  // 第二轮：剩下的字段用正则
  for (const field of preset.fields) {
    if (mapping[field.key] !== undefined || !field.patterns) continue;
    outer: for (const re of field.patterns) {
      for (let i = 0; i < normalized.length; i++) {
        if (!used.has(i) && normalized[i] && re.test(normalized[i]!)) {
          used.add(i);
          mapping[field.key] = i;
          matches.push({ field: field.key, column: i, header: String(headerCells[i] ?? ''), via: 'pattern' });
          break outer;
        }
      }
    }
  }
  const missing = preset.required.filter((group) => !group.some((k) => mapping[k] !== undefined));
  const satisfied = preset.required.length - missing.length;
  const score = satisfied * 10 + matches.length;
  return { mapping, matches, missing, score };
}

/** 在所有工作表、前若干行里找最佳的（报表类型, 表头行）组合 */
export function detectReport(sheets: Sheet[], presets: ReportPreset[]): Detection | null {
  type Candidate = Detection & { complete: boolean };
  let best: Candidate | null = null;
  const bestPerPreset = new Map<string, { score: number; complete: boolean; name: string }>();

  sheets.forEach((sheet, sheetIndex) => {
    const limit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS);
    for (let r = 0; r < limit; r++) {
      const cells = sheet.rows[r] ?? [];
      const nonEmpty = cells.filter((c) => c !== null && c !== undefined && String(c).trim() !== '').length;
      if (nonEmpty < 3) continue;
      for (const preset of presets) {
        const res = matchHeaders(cells, preset);
        if (res.matches.length < 3) continue;
        const complete = res.missing.length === 0;
        const prev = bestPerPreset.get(preset.id);
        if (!prev || res.score > prev.score) bestPerPreset.set(preset.id, { score: res.score, complete, name: preset.name });
        const better =
          !best ||
          (complete && !best.complete) ||
          (complete === best.complete && res.score > best.score);
        if (better) {
          best = {
            sheetIndex,
            sheetName: sheet.name,
            headerRow: r,
            headers: cells.map((c) => (c === null || c === undefined ? '' : String(c))),
            preset,
            mapping: res.mapping,
            matches: res.matches,
            missing: res.missing,
            score: res.score,
            alternatives: [],
            complete,
          };
        }
      }
    }
  });

  if (!best) return null;
  const chosen: Candidate = best;
  chosen.alternatives = [...bestPerPreset.entries()]
    .filter(([id]) => id !== chosen.preset.id)
    .map(([presetId, v]) => ({ presetId, name: v.name, score: v.score, complete: v.complete }))
    .sort((a, b) => b.score - a.score);
  const { complete: _complete, ...detection } = chosen;
  return detection;
}

/** 强制使用某个报表类型（用户在界面上切换时） */
export function detectWithPreset(sheets: Sheet[], preset: ReportPreset): Detection | null {
  return detectReport(sheets, [preset]);
}

/** 用户手动指定或取消某个字段对应的列 */
export function setMapping(d: Detection, field: FieldKey, column: number | null): Detection {
  const mapping: Mapping = { ...d.mapping };
  let matches = d.matches.filter((m) => m.field !== field);
  if (column === null) {
    delete mapping[field];
  } else {
    // 同一列不能同时对应两个字段
    for (const [k, v] of Object.entries(mapping)) if (v === column) delete mapping[k as FieldKey];
    matches = matches.filter((m) => m.column !== column);
    mapping[field] = column;
    matches.push({ field, column, header: d.headers[column] ?? '', via: 'manual' });
  }
  const missing = d.preset.required.filter((group) => !group.some((k) => mapping[k] !== undefined));
  return { ...d, mapping, matches, missing };
}
