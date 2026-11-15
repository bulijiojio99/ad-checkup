import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export function downloadText(fileName: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function NumberField(props: {
  label: string;
  value: string;
  onInput: (v: string) => void;
  suffix?: string;
  prefix?: string;
  hint?: string;
  id: string;
}) {
  return (
    <label class="field" for={props.id}>
      <span class="field-label">{props.label}</span>
      <span class="field-input">
        {props.prefix && <span class="affix">{props.prefix}</span>}
        <input
          id={props.id}
          inputMode="decimal"
          autoComplete="off"
          value={props.value}
          onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
        />
        {props.suffix && <span class="affix">{props.suffix}</span>}
      </span>
      {props.hint && <span class="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Disclosure(props: { summary: string; children: ComponentChildren; open?: boolean }) {
  return (
    <details class="disclosure" open={props.open}>
      <summary>{props.summary}</summary>
      <div class="disclosure-body">{props.children}</div>
    </details>
  );
}

export function CopyButton(props: { text: () => string; label: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      class="btn btn-secondary"
      onClick={async () => {
        const ok = await copyText(props.text());
        setState(ok ? 'ok' : 'fail');
        setTimeout(() => setState('idle'), 2200);
      }}
    >
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败，请手动选择' : props.label}
    </button>
  );
}

export function LockIcon() {
  return (
    <svg class="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.4" />
    </svg>
  );
}

export function num(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
