import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/web/markdown';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf-8');

describe('markdown renderer for the legal pages', () => {
  it('escapes HTML instead of rendering it', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
  it('only allows in-app and http(s) links', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toContain('href="#"');
    expect(renderMarkdown('[协议](#/terms)')).toContain('href="#/terms"');
    expect(renderMarkdown('[GH](https://github.com)')).toContain('rel="noopener noreferrer"');
  });
  it('renders headings, lists, bold and tables', () => {
    const html = renderMarkdown('# 标题\n\n- **重点**\n- 二\n\n1. 一\n2. 二\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<ul><li><strong>重点</strong></li><li>二</li></ul>');
    expect(html).toContain('<ol><li>一</li><li>二</li></ol>');
    expect(html).toContain('<td>1</td><td>2</td>');
  });
});

describe('legal documents', () => {
  const terms = read('docs/legal/terms.md');
  const privacy = read('docs/legal/privacy.md');

  it.each([
    ['terms', terms],
    ['privacy', privacy],
  ])('%s renders without leftover markdown syntax', (_name, md) => {
    const html = renderMarkdown(md);
    expect(html).toMatch(/^<h1>/);
    expect(html).not.toContain('**');
    expect(html).not.toMatch(/\]\(/);
  });

  it('the open-source version states it collects no report data', () => {
    expect(privacy).toContain('没有任何收集、上传或保存你报表数据的功能');
    expect(terms).toContain('没有收集、上传或保存你报表数据的功能');
    expect(privacy).not.toContain('贡献编号');
  });

  it('the open-source code has no data collection endpoint', () => {
    for (const f of ['src/web/App.tsx', 'src/web/Report.tsx']) expect(read(f)).not.toMatch(/api\/contribute|localStorage/);
  });

  it('the open-source version has no network code and no server', () => {
    const files = (readdirSync(new URL('../src', import.meta.url), { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(read(`src/${f}`), f).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    expect(existsSync(new URL('../server', import.meta.url))).toBe(false);
    expect(read('vite.config.ts')).not.toMatch(/VITE_AI_ENDPOINT|VITE_API_BASE|loadEnv/);
  });

  it('the promise “the page cannot send data” matches the build config', () => {
    expect(privacy).toContain("connect-src 'none'");
    expect(read('vite.config.ts')).toContain(`"connect-src 'none'"`);
  });
});
