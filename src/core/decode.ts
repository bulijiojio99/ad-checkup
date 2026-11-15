/**
 * 文本编码识别。国内平台导出的 CSV 经常是 GBK/GB18030，直接按 UTF-8 读会乱码，
 * 乱码的表头会导致整份报表识别失败，所以这里按“严格 UTF-8 → GB18030 → Shift_JIS → Latin-1”的顺序尝试。
 */

export interface DecodedText {
  text: string;
  encoding: string;
}

function tryDecode(bytes: Uint8Array, label: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

function looksUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, 400);
  if (n < 4) return null;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0) {
      if (i % 2 === 0) evenZero++;
      else oddZero++;
    }
  }
  if (oddZero > n * 0.3 && evenZero < n * 0.05) return 'utf-16le';
  if (evenZero > n * 0.3 && oddZero < n * 0.05) return 'utf-16be';
  return null;
}

function replacementRatio(text: string): number {
  if (!text) return 0;
  let bad = 0;
  for (const ch of text) if (ch === '�') bad++;
  return bad / text.length;
}

export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'UTF-8 (BOM)' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16LE' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16BE' };
  }
  const utf16 = looksUtf16(bytes);
  if (utf16) {
    const t = tryDecode(bytes, utf16, false);
    if (t !== null) return { text: t, encoding: utf16.toUpperCase() };
  }
  const utf8 = tryDecode(bytes, 'utf-8', true);
  if (utf8 !== null) return { text: utf8, encoding: 'UTF-8' };

  for (const label of ['gb18030', 'gbk', 'shift_jis']) {
    const t = tryDecode(bytes, label, true);
    if (t !== null && replacementRatio(t) === 0) return { text: t, encoding: label.toUpperCase() };
  }
  const gb = tryDecode(bytes, 'gb18030', false);
  if (gb !== null && replacementRatio(gb) < 0.01) return { text: gb, encoding: 'GB18030' };
  return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'WINDOWS-1252' };
}
