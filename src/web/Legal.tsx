import { useMemo } from 'preact/hooks';
import privacy from '../../docs/legal/privacy.md?raw';
import terms from '../../docs/legal/terms.md?raw';
import { renderMarkdown } from './markdown';

export type LegalDoc = 'terms' | 'privacy';

export function routeFromHash(hash: string): LegalDoc | null {
  if (hash === '#/terms') return 'terms';
  if (hash === '#/privacy') return 'privacy';
  return null;
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const html = useMemo(() => renderMarkdown(doc === 'terms' ? terms : privacy), [doc]);
  return (
    <article class="legal" aria-label={doc === 'terms' ? '使用协议' : '隐私政策'}>
      <p class="legal-nav">
        <a href="#/">返回工具</a>
        {doc === 'terms' ? <a href="#/privacy">隐私政策</a> : <a href="#/terms">使用协议</a>}
      </p>
      <div class="legal-body" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
