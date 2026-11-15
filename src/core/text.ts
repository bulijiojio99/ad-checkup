/** 文本归一化与分词工具。 */

/**
 * 表头归一化：全角转半角、转小写、去掉括号里的单位说明、去掉空格和标点。
 * 例："7 Day Total Orders (#)" → "7daytotalorders"；"成交金额（元）" → "成交金额"
 */
export function normalizeHeader(input: unknown): string {
  if (input === null || input === undefined) return '';
  // 表头不会很长；先截断，避免超长单元格让下面的正则跑很久
  let s = String(input).slice(0, 200).normalize('NFKC').toLowerCase().trim();
  s = s.replace(/^﻿/, '');
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/\[[^\]]*\]/g, '');
  s = s.replace(/[\s_\-–—:：/\\|,，.。、#%*'"“”‘’`~!！?？;；+=<>《》【】]+/g, '');
  return s;
}

/** 维度值归一化（用于汇总时的键）：去首尾空白、合并空白、转小写 */
export function normalizeKey(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function cleanText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).normalize('NFKC').trim().replace(/\s+/g, ' ');
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'and', 'or', 'of', 'to', 'in', 'on', 'with', 'by', 'at', 'from', 'is', 'are',
  'my', 'your', 'me', 'i', 'it', 'this', 'that', 'de', 'la', 'le', 'les', 'und', 'der', 'die', 'das', 'für',
  '的', '了', '和', '与', '及', '在', '是', '有', '我', '你', '吗', '呢', '啊', '吧', '个', '怎么', '什么', '哪个', '哪些',
]);

const CJK = /[㐀-鿿豈-﫿]/;

function stem(token: string): string {
  if (token.length > 3 && /[a-z]s$/.test(token) && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

type SegmenterLike = { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> };
let segmenter: SegmenterLike | null | undefined;

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: object) => SegmenterLike }).Segmenter;
    segmenter = Seg ? new Seg('zh', { granularity: 'word' }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/**
 * 分词：中英文混合。优先用浏览器/Node 自带的 Intl.Segmenter（支持中文词典分词），
 * 不可用时英文按非字母数字切分、中文按相邻两字切分。
 */
export function tokenize(input: string): string[] {
  const text = input.normalize('NFKC').toLowerCase();
  const seg = getSegmenter();
  const out: string[] = [];
  if (seg) {
    for (const part of seg.segment(text)) {
      if (part.isWordLike === false) continue;
      const t = part.segment.trim();
      if (!t || !/[\p{L}\p{N}]/u.test(t)) continue;
      if (STOPWORDS.has(t)) continue;
      out.push(CJK.test(t) ? t : stem(t));
    }
    return out;
  }
  for (const chunk of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!chunk) continue;
    if (CJK.test(chunk)) {
      const chars = [...chunk];
      if (chars.length === 1) out.push(chunk);
      for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i]! + chars[i + 1]!);
    } else if (!STOPWORDS.has(chunk)) {
      out.push(stem(chunk));
    }
  }
  return out;
}

export interface ProductIndex {
  latin: Set<string>;
  cjkChars: Set<string>;
  cjkBigrams: Set<string>;
}

/** 产品描述的索引：英文按词，中文按单字和相邻两字（不依赖分词结果，避免分词不一致造成误判） */
export function indexProduct(text: string): ProductIndex {
  const norm = text.normalize('NFKC').toLowerCase();
  const latin = new Set(tokenize(norm).filter((t) => !CJK.test(t)));
  const cjkChars = new Set<string>();
  const cjkBigrams = new Set<string>();
  for (const run of norm.match(/[㐀-鿿豈-﫿]+/g) ?? []) {
    const chars = [...run];
    chars.forEach((c, i) => {
      cjkChars.add(c);
      if (i + 1 < chars.length) cjkBigrams.add(c + chars[i + 1]);
    });
  }
  return { latin, cjkChars, cjkBigrams };
}

/** 一个词是否被产品描述覆盖：中文要求每个相邻两字都出现在描述里，英文要求词本身出现 */
export function coveredByProduct(token: string, idx: ProductIndex): boolean {
  if (CJK.test(token)) {
    const chars = [...token];
    if (chars.length === 1) return idx.cjkChars.has(token);
    for (let i = 0; i + 1 < chars.length; i++) if (!idx.cjkBigrams.has(chars[i]! + chars[i + 1]!)) return false;
    return true;
  }
  return idx.latin.has(token);
}

/** 亚马逊自动广告里，搜索词可能是 ASIN（小写，如 b0abcd1234） */
export function looksLikeAsin(term: string): boolean {
  return /^b0[a-z0-9]{8}$/i.test(term.trim());
}
