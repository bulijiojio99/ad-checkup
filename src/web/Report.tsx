import { useState } from 'preact/hooks';
import { actionsCsv, aiPrompt, negativesCsv, TIER_LABEL } from '../core/export';
import { int, money, pct, ratio } from '../core/format';
import type { Report } from '../core/report';
import type { RootResult } from '../core/roots';
import type { RowResult, Tier } from '../core/types';
import { PLATFORMS } from '../platforms';
import { CopyButton, Disclosure, downloadText } from './ui';

type TabId = Tier | 'roots';

const PAGE = 50;

const FLAG_LABEL: Record<string, string> = {
  asin: 'ASIN',
  exactConflict: '精准关键词本身',
  smallSample: '样本少',
  ordersEstimated: '订单为估算',
  keyword: '投放关键词',
};

const REL_LABEL = { related: '和产品相关', partial: '部分相关', unrelated: '可能不相关' } as const;

function headline(report: Report) {
  const s = report.target.source;
  if (s === 'breakeven') return '有统计依据的亏损花费';
  if (s === 'accountAverage') return '明显拖低整体效率的花费';
  return '有统计依据的未达标花费';
}

function effLabel(report: Report): string {
  if (report.preset.conversion === 'engagements') return '互动成本';
  return report.platform === 'amazon' ? 'ACoS' : 'ROI';
}

function effText(report: Report, r: { spend: number; sales: number; orders: number; engagements: number }): string {
  if (report.preset.conversion === 'engagements') return r.engagements > 0 ? money(r.spend / r.engagements, report.symbol) : '—';
  if (r.sales <= 0) return '—';
  return report.platform === 'amazon' ? pct(r.spend / r.sales) : ratio(r.sales / r.spend);
}

export function ReportView({ report, product }: { report: Report; product: string }) {
  const meta = PLATFORMS[report.platform];
  const isTerm = report.preset.kind === 'searchTerm';
  const isOrders = report.preset.conversion === 'orders';
  const c = report.summary.counts;
  const tabs: { id: TabId; label: string; count: number }[] = (
    [
      { id: 'loss', label: TIER_LABEL.loss, count: c.loss },
      { id: 'suspect', label: TIER_LABEL.suspect, count: c.suspect },
      { id: 'win', label: TIER_LABEL.win, count: c.win },
      { id: 'roots', label: '词根', count: report.roots.length },
      { id: 'insufficient', label: '待观察', count: c.insufficient },
      { id: 'ok', label: TIER_LABEL.ok, count: c.ok },
      { id: 'untested', label: TIER_LABEL.untested, count: c.untested },
    ] as { id: TabId; label: string; count: number }[]
  ).filter((t) => t.id === 'loss' || t.count > 0);
  const [tab, setTab] = useState<TabId>(c.loss > 0 ? 'loss' : (tabs.find((t) => t.count > 0)?.id ?? 'loss'));
  const t = report.totals;
  const d = report.derived;
  const sym = report.symbol;
  const stamp = new Date(report.generatedAt).toISOString().slice(0, 10);
  const hasNegatives =
    report.results.some((r) => ['negate', 'negateAsin'].includes(r.action.code)) || report.roots.some((r) => !r.cautious);

  return (
    <div class="report">
      <header class="report-head">
        <p class="report-meta">
          {meta.name} {report.preset.name}
          {report.period ? `，${report.period.start} 至 ${report.period.end}（${report.period.days} 天）` : ''}
        </p>
        <div class="headline">
          <p class="headline-label">{headline(report)}</p>
          <p class="headline-value">{money(report.summary.saving, sym)}</p>
          <p class="headline-sub">
            {report.summary.saving > 0
              ? `占这份报表总花费的 ${pct(report.summary.savingShare)}。${report.summary.monthlySaving !== null ? `按 ${report.period!.days} 天的数据折算，每月约 ${money(report.summary.monthlySaving, sym, 0)}。` : ''}`
              : '这份报表里没有发现有足够把握的低效花费。'}
            {report.summary.suspectSpend > 0 && ` 另有 ${money(report.summary.suspectSpend, sym)} 的花费疑似低效，数据还不够确定。`}
          </p>
        </div>
        <div class="target-line">
          <p>
            参照线：<strong>{report.target.label}</strong>
          </p>
          {report.target.lines.length > 0 && (
            <ul class="plain-list small muted">
              {report.target.lines.map((l) => (
                <li>{l}</li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <dl class="stats stats-report">
        <div>
          <dt>总花费</dt>
          <dd>{money(t.spend, sym)}</dd>
        </div>
        {isOrders ? (
          <>
            <div>
              <dt>销售额</dt>
              <dd>{money(t.sales, sym)}</dd>
            </div>
            <div>
              <dt>{report.platform === 'amazon' ? '整体 ACoS' : '整体 ROI'}</dt>
              <dd>{report.platform === 'amazon' ? pct(d.acos) : ratio(d.roi)}</dd>
            </div>
            <div>
              <dt>订单</dt>
              <dd>{int(t.orders)}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>互动</dt>
              <dd>{int(t.engagements)}</dd>
            </div>
            <div>
              <dt>平均互动成本</dt>
              <dd>{money(d.cpe, sym)}</dd>
            </div>
          </>
        )}
        {t.clicks !== null && (
          <div>
            <dt>点击</dt>
            <dd>{int(t.clicks)}</dd>
          </div>
        )}
        {d.cpc !== null && (
          <div>
            <dt>平均点击单价</dt>
            <dd>{money(d.cpc, sym)}</dd>
          </div>
        )}
      </dl>

      {report.notes.length > 0 && (
        <ul class="issues">
          {report.notes.map((n) => (
            <li class="issue issue-warn">{n}</li>
          ))}
        </ul>
      )}

      <div class="tabs" role="tablist" aria-label="诊断结果分类">
        {tabs.map((x) => (
          <button
            type="button"
            role="tab"
            id={`tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls="tabpanel"
            class={`tab tab-${x.id} ${tab === x.id ? 'is-active' : ''}`}
            onClick={() => setTab(x.id)}
          >
            {x.label}
            <span class="tab-count">{x.count}</span>
          </button>
        ))}
      </div>

      <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} class="tabpanel">
        <TabIntro tab={tab} report={report} />
        {tab === 'roots' ? (
          <RootsTable roots={report.roots} sym={sym} />
        ) : (
          <ResultTable key={tab} rows={report.results.filter((r) => r.tier === tab)} report={report} isTerm={isTerm} isOrders={isOrders} hasClicks={t.clicks !== null} />
        )}
      </div>

      <div class="exports">
        <button type="button" class="btn btn-secondary" onClick={() => downloadText(`投流体检_全部结论_${stamp}.csv`, actionsCsv(report))}>
          导出全部结论（CSV）
        </button>
        {isTerm && hasNegatives && (
          <button type="button" class="btn btn-secondary" onClick={() => downloadText(`投流体检_否定词清单_${stamp}.csv`, negativesCsv(report))}>
            导出否定词清单（CSV）
          </button>
        )}
        {isTerm && isOrders && <CopyButton label="复制 AI 相关性判断提示词" text={() => aiPrompt(report, product)} />}
        <button type="button" class="btn btn-secondary" onClick={() => window.print()}>
          打印或存为 PDF
        </button>
      </div>
      {isTerm && report.platform === 'amazon' && (
        <p class="muted small">
          否定词清单按广告活动和广告组名称列出。亚马逊批量上传需要广告活动 ID，请在后台逐个添加，或从后台下载批量表格后按清单填写。
        </p>
      )}
      {isTerm && isOrders && (
        <p class="muted small">
          AI 提示词只让 AI 判断“搜索词和产品是否相关”，数字判断已经由统计完成。可以粘贴到 DeepSeek、Kimi 或 ChatGPT 里使用。
        </p>
      )}

      <Disclosure summary="判断依据与计算方法">
        <ul class="plain-list">
          {report.method.map((m) => (
            <li>{m}</li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

function TabIntro({ tab, report }: { tab: TabId; report: Report }) {
  const relative = report.target.source === 'accountAverage';
  const text: Record<TabId, string> = {
    loss: relative
      ? '这些行的效率明显低于账户平均水平，统计上有足够把握（单项把握 95% 以上，并做了多重比较校正）。'
      : '这些行在统计上有足够把握达不到参照线（单项把握 95% 以上，并做了多重比较校正），可以按建议处理。',
    suspect: '有一定迹象偏差，但把握还不够（80%–95%）。建议小幅调整并继续观察，不要急着否定。',
    win: '这些行的效率明显好于参照线，可以考虑加大投入。',
    roots: '把搜索词拆成词后累计：单个搜索词点击少看不出来，但同一个词根在多个搜索词里累计亏损，适合加否定词组。整体否定前请确认它不是你的核心词。',
    insufficient: '数据还不够下结论：要么点击太少，要么目前低于参照线但差距还可能是正常波动。先不动，过一段时间再看。',
    ok: '没有发现明显问题。',
    untested: '缺少计算所需的数据（例如没有成交也没有客单价），无法判断。',
  };
  return <p class="tab-intro">{text[tab]}</p>;
}

function ResultTable({
  rows,
  report,
  isTerm,
  isOrders,
  hasClicks,
}: {
  rows: RowResult[];
  report: Report;
  isTerm: boolean;
  isOrders: boolean;
  hasClicks: boolean;
}) {
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <p class="empty">这一类没有内容。</p>;
  const sym = report.symbol;
  return (
    <>
      <div class="table-wrap">
        <table class="results">
          <thead>
            <tr>
              <th scope="col">{isTerm ? '搜索词' : '名称'}</th>
              <th scope="col" class="col-group">{isTerm ? '广告活动 / 广告组' : '所属计划'}</th>
              {hasClicks && <th scope="col" class="num">点击</th>}
              <th scope="col" class="num">{isOrders ? '订单' : '互动'}</th>
              <th scope="col" class="num">花费</th>
              <th scope="col" class="num">{effLabel(report)}</th>
              <th scope="col">建议</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const isOpen = open === r.row.key;
              return (
                <>
                  <tr class={`row tier-${r.tier} ${isOpen ? 'is-open' : ''}`}>
                    <td data-label={isTerm ? '搜索词' : '名称'}>
                      <button type="button" class="row-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.row.key)}>
                        {r.row.name}
                      </button>
                      {r.flags.map((f) => (
                        <span class="tag">{FLAG_LABEL[f] ?? f}</span>
                      ))}
                    </td>
                    <td data-label={isTerm ? '广告活动 / 广告组' : '所属计划'} class="col-group muted small">
                      {r.row.campaign ?? '—'}
                      {r.row.adGroup ? <span class="block">{r.row.adGroup}</span> : null}
                    </td>
                    {hasClicks && <td data-label="点击" class="num">{r.row.clicks === null ? '—' : int(r.row.clicks)}</td>}
                    <td data-label={isOrders ? '订单' : '互动'} class="num">{int(isOrders ? r.row.orders : r.row.engagements)}</td>
                    <td data-label="花费" class="num">{money(r.row.spend, sym)}</td>
                    <td data-label={effLabel(report)} class="num">{effText(report, r.row)}</td>
                    <td data-label="建议" class="action">{r.action.text}</td>
                  </tr>
                  {isOpen && (
                    <tr class="row-detail">
                      <td colSpan={hasClicks ? 7 : 6}>
                        {(() => {
                          const detail = r.action.detail;
                          return detail ? <p>
                              <strong>为什么这样建议：</strong>
                              {detail}
                            </p> : null;
                        })()}
                        <p>{r.explanation}</p>
                        <p class="muted small">
                          {r.relevance ? `相关性粗判：${REL_LABEL[r.relevance]}（按产品描述的字词比对，仅供参考）。` : ''}
                          {r.evidence.aovSource && r.evidence.aov !== null
                            ? `客单价按${{ row: '这一行自己的订单（与组平均加权）', group: '所在广告组的平均（与全账户加权）', account: '整份报表的平均', price: '你填写的售价' }[r.evidence.aovSource]}估算：${money(r.evidence.aov, sym)}。`
                            : ''}
                          {r.row.targetings.length > 0 && `触发它的投放：${r.row.targetings.slice(0, 4).map((x) => x.text || '（空）').join('、')}。`}
                          来自文件第 {r.row.sourceRows.slice(0, 12).join('、')}
                          {r.row.sourceRows.length > 12 ? ` 等 ${r.row.sourceRows.length} ` : ' '}
                          行。
                        </p>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button type="button" class="btn btn-link more" onClick={() => setLimit(limit + PAGE * 4)}>
          显示更多（还有 {rows.length - limit} 行）
        </button>
      )}
    </>
  );
}

function RootsTable({ roots, sym }: { roots: RootResult[]; sym: string }) {
  if (roots.length === 0) return <p class="empty">没有发现累计亏损的词根。</p>;
  return (
    <div class="table-wrap">
      <table class="results">
        <thead>
          <tr>
            <th scope="col">词根</th>
            <th scope="col" class="num">涉及搜索词</th>
            <th scope="col" class="num">点击</th>
            <th scope="col" class="num">订单</th>
            <th scope="col" class="num">花费</th>
            <th scope="col">建议</th>
          </tr>
        </thead>
        <tbody>
          {roots.map((r) => (
            <tr class={`row ${r.cautious ? 'tier-suspect' : 'tier-loss'}`}>
              <td data-label="词根">
                <strong>{r.token}</strong>
                <span class="block muted small">例如：{r.examples.join('、')}</span>
              </td>
              <td data-label="涉及搜索词" class="num">{r.termCount}</td>
              <td data-label="点击" class="num">{int(r.clicks)}</td>
              <td data-label="订单" class="num">{int(r.orders)}</td>
              <td data-label="花费" class="num">{money(r.spend, sym)}</td>
              <td data-label="建议" class="action">{r.advice}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
