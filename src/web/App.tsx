import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { detectReport, setMapping, type Detection } from '../core/detect';
import { amazonBreakeven, domesticBreakeven, type AmazonCosts, type DomesticCosts } from '../core/economics';
import { money, pct, ratio, int, currencySymbol } from '../core/format';
import { detectForPlatform, prepareDataset, readTable, runDiagnosis } from '../core/pipeline';
import type { Report, TargetInput } from '../core/report';
import type { Dataset, FieldKey, PlatformId, ReportPreset, Sheet } from '../core/types';
import { PLATFORMS, presetById } from '../platforms';
import { SAMPLES, SAMPLE_LIST } from '../samples/generate';
import { ReportView } from './Report';
import { LegalPage, routeFromHash, type LegalDoc } from './Legal';
import { Disclosure, LockIcon, NumberField, num } from './ui';

type Source = { name: string; sheets: Sheet[]; isSample: boolean; encoding?: string };
type TargetMode = 'costs' | 'target' | 'auto';

const PLATFORM_ORDER: PlatformId[] = ['amazon', 'douyin', 'xiaohongshu'];
const MAX_BYTES = 60 * 1024 * 1024;

const EMPTY_AMAZON = { price: '', productCost: '', fbaFee: '', referralPct: '15', otherCost: '' };
const EMPTY_DOMESTIC = { price: '', productCost: '', shipping: '', platformPct: '', commissionPct: '', returnRatePct: '' };

function manualDetection(sheets: Sheet[], preset: ReportPreset): Detection | null {
  for (let s = 0; s < sheets.length; s++) {
    const sheet = sheets[s]!;
    const limit = Math.min(sheet.rows.length, 40);
    for (let r = 0; r < limit; r++) {
      const cells = sheet.rows[r] ?? [];
      const nonEmpty = cells.filter((c) => c !== null && c !== undefined && String(c).trim() !== '').length;
      if (nonEmpty >= 3) {
        return {
          sheetIndex: s,
          sheetName: sheet.name,
          headerRow: r,
          headers: cells.map((c) => (c === null || c === undefined ? '' : String(c))),
          preset,
          mapping: {},
          matches: [],
          missing: preset.required,
          score: 0,
          alternatives: [],
        };
      }
    }
  }
  return null;
}

function amazonCostsFrom(v: typeof EMPTY_AMAZON): { costs?: AmazonCosts; errors: string[] } {
  const errors: string[] = [];
  const price = num(v.price);
  const productCost = num(v.productCost);
  const fbaFee = num(v.fbaFee);
  const referralPct = num(v.referralPct);
  const otherCost = num(v.otherCost);
  if (price === undefined) errors.push('请填写售价');
  if (productCost === undefined) errors.push('请填写采购及头程成本');
  if (fbaFee === undefined) errors.push('请填写 FBA 配送费（自发货填 0 并把运费计入其他成本）');
  if (referralPct === undefined) errors.push('请填写佣金比例');
  for (const [label, x] of [['售价', price], ['采购及头程成本', productCost], ['FBA 配送费', fbaFee], ['佣金比例', referralPct], ['其他成本', otherCost]] as const) {
    if (x !== undefined && Number.isNaN(x)) errors.push(`${label}不是有效数字`);
  }
  if (errors.length) return { errors };
  return { costs: { price: price!, productCost: productCost!, fbaFee: fbaFee!, referralPct: referralPct!, otherCost: otherCost ?? 0 }, errors };
}

function domesticCostsFrom(v: typeof EMPTY_DOMESTIC): { costs?: DomesticCosts; errors: string[] } {
  const errors: string[] = [];
  const price = num(v.price);
  const productCost = num(v.productCost);
  const shipping = num(v.shipping);
  const platformPct = num(v.platformPct);
  const commissionPct = num(v.commissionPct);
  const returnRatePct = num(v.returnRatePct);
  if (price === undefined) errors.push('请填写客单价');
  if (productCost === undefined) errors.push('请填写商品成本');
  if (shipping === undefined) errors.push('请填写快递费（包邮也要算上实际运费）');
  if (platformPct === undefined) errors.push('请填写平台扣点');
  if (returnRatePct === undefined) errors.push('请填写退货率（没有退货填 0）');
  for (const [label, x] of [['客单价', price], ['商品成本', productCost], ['快递费', shipping], ['平台扣点', platformPct], ['达人佣金', commissionPct], ['退货率', returnRatePct]] as const) {
    if (x !== undefined && Number.isNaN(x)) errors.push(`${label}不是有效数字`);
  }
  if (errors.length) return { errors };
  return {
    costs: { price: price!, productCost: productCost!, shipping: shipping!, platformPct: platformPct!, commissionPct: commissionPct ?? 0, returnRatePct: returnRatePct! },
    errors,
  };
}

export function App() {
  const [platform, setPlatform] = useState<PlatformId>('amazon');
  const [source, setSource] = useState<Source | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<TargetMode>('costs');
  const [amazon, setAmazon] = useState(EMPTY_AMAZON);
  const [domestic, setDomestic] = useState(EMPTY_DOMESTIC);
  const [targetValue, setTargetValue] = useState('');
  const [product, setProduct] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [report, setReport] = useState<{ report: Report; signature: string } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLElement>(null);
  // 协议页用地址栏的 #/terms、#/privacy 切换；工具页的状态保存在这里，切回来不会丢
  const [route, setRoute] = useState<LegalDoc | null>(() => routeFromHash(location.hash));

  useEffect(() => {
    const onHash = () => {
      const next = routeFromHash(location.hash);
      setRoute(next);
      if (next) window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const meta = PLATFORMS[platform];
  const preset = detection?.preset ?? null;
  const conversion = preset?.conversion ?? 'orders';
  const costModel = meta.costModel;

  const amazonParsed = useMemo(() => amazonCostsFrom(amazon), [amazon]);
  const domesticParsed = useMemo(() => domesticCostsFrom(domestic), [domestic]);
  const price = costModel === 'amazon' ? num(amazon.price) : num(domestic.price);
  const validPrice = price !== undefined && !Number.isNaN(price) && price > 0 ? price : null;

  // 售价输入停顿一会儿再重新整理数据：大报表整理一次要一两秒，不能每输一个字就算一遍
  const [datasetPrice, setDatasetPrice] = useState<number | null>(validPrice);
  useEffect(() => {
    const id = setTimeout(() => setDatasetPrice(validPrice), 400);
    return () => clearTimeout(id);
  }, [validPrice]);

  const dataset: Dataset | null = useMemo(() => {
    if (!source || !detection) return null;
    try {
      return prepareDataset(source.sheets, detection, { price: datasetPrice, currency });
    } catch {
      return null;
    }
  }, [source, detection, datasetPrice, currency]);

  const sym = currencySymbol(dataset?.currency ?? meta.defaultCurrency);

  const breakevenPreview = useMemo(() => {
    if (mode !== 'costs' || conversion !== 'orders') return null;
    if (costModel === 'amazon') {
      if (!amazonParsed.costs) return null;
      const r = amazonBreakeven(amazonParsed.costs);
      return r.ok ? { text: `保本 ACoS ${pct(r.value.acos)}`, lines: r.value.lines, error: null } : { text: '', lines: [], error: r.error };
    }
    if (!domesticParsed.costs) return null;
    const r = domesticBreakeven(domesticParsed.costs);
    return r.ok ? { text: `保本 ROI ${ratio(r.value.roi)}`, lines: r.value.lines, error: null } : { text: '', lines: [], error: r.error };
  }, [mode, conversion, costModel, amazonParsed, domesticParsed]);

  const targetInput: { input?: TargetInput; errors: string[] } = useMemo(() => {
    if (conversion === 'engagements') {
      if (mode === 'target') {
        const v = num(targetValue);
        if (v === undefined || Number.isNaN(v) || v <= 0) return { errors: ['请填写目标互动成本'] };
        return { input: { type: 'cpe', value: v }, errors: [] };
      }
      return { input: { type: 'auto' }, errors: [] };
    }
    if (mode === 'auto') return { input: { type: 'auto' }, errors: [] };
    if (mode === 'target') {
      const v = num(targetValue);
      if (v === undefined || Number.isNaN(v) || v <= 0) return { errors: [meta.metric === 'acos' ? '请填写目标 ACoS' : '请填写目标 ROI'] };
      return { input: meta.metric === 'acos' ? { type: 'acos', value: v / 100 } : { type: 'roi', value: v }, errors: [] };
    }
    if (costModel === 'amazon') {
      return amazonParsed.costs ? { input: { type: 'amazonCosts', costs: amazonParsed.costs }, errors: [] } : { errors: amazonParsed.errors };
    }
    return domesticParsed.costs ? { input: { type: 'domesticCosts', costs: domesticParsed.costs }, errors: [] } : { errors: domesticParsed.errors };
  }, [conversion, mode, targetValue, meta.metric, costModel, amazonParsed, domesticParsed]);

  const signature = JSON.stringify([platform, source?.name, detection?.mapping, detection?.preset.id, currency, mode, amazon, domestic, targetValue, product]);
  const stale = report !== null && report.signature !== signature;

  useEffect(() => {
    if (report && reportRef.current && report.signature === signature) {
      reportRef.current.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
    // 只在生成新报告时滚动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.report.generatedAt]);

  function resetAll(p: PlatformId) {
    setPlatform(p);
    setSource(null);
    setDetection(null);
    setLoadError(null);
    setReport(null);
    setRunError(null);
    setCurrency(null);
    setMode('costs');
    setTargetValue('');
  }

  function acceptSheets(src: Source) {
    setSource(src);
    setReport(null);
    setRunError(null);
    setCurrency(null);
    const det = detectForPlatform(src.sheets, platform) ?? manualDetection(src.sheets, PLATFORMS[platform].presets[0]!);
    if (!det) {
      setDetection(null);
      setLoadError('文件里没有找到表格数据。请确认上传的是从广告后台导出的报表。');
      return;
    }
    setDetection(det);
    setLoadError(null);
    if (det.preset.conversion === 'engagements') setMode('auto');
  }

  async function onFile(file: File) {
    setLoadError(null);
    if (file.size > MAX_BYTES) {
      setLoadError('文件超过 60MB。请缩短日期范围后重新导出。');
      return;
    }
    setLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sheets = await readTable(bytes, file.name);
      acceptSheets({ name: file.name, sheets, isSample: false, encoding: sheets[0]?.encoding });
    } catch (e) {
      setSource(null);
      setDetection(null);
      setLoadError(`读取失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function onSample(id: string) {
    const s = SAMPLES[id]!();
    if (s.amazonCosts) {
      const c = s.amazonCosts;
      setAmazon({ price: String(c.price), productCost: String(c.productCost), fbaFee: String(c.fbaFee), referralPct: String(c.referralPct), otherCost: '' });
    }
    if (s.domesticCosts) {
      const c = s.domesticCosts;
      setDomestic({ price: String(c.price), productCost: String(c.productCost), shipping: String(c.shipping), platformPct: String(c.platformPct), commissionPct: String(c.commissionPct ?? ''), returnRatePct: String(c.returnRatePct) });
    }
    setProduct(s.product);
    setMode(s.amazonCosts || s.domesticCosts ? 'costs' : 'auto');
    acceptSheets({ name: s.fileName, sheets: [{ name: s.fileName, rows: s.rows, rowOffset: 0 }], isSample: true });
  }

  function changePreset(id: string) {
    if (!source) return;
    const p = presetById(id);
    if (!p) return;
    const det = detectReport(source.sheets, [p]) ?? manualDetection(source.sheets, p);
    setDetection(det);
    setReport(null);
    if (p.conversion === 'engagements') setMode('auto');
    else if (mode === 'auto' && preset?.conversion === 'engagements') setMode('costs');
  }

  function generate() {
    if (!detection || !dataset || !targetInput.input) return;
    setRunning(true);
    setRunError(null);
    const input = targetInput.input;
    setTimeout(() => {
      try {
        // 刚改完售价就点生成时，数据可能还没按新售价整理，这里补算一次
        const ds = datasetPrice === validPrice || !source ? dataset : prepareDataset(source.sheets, detection, { price: validPrice, currency });
        const res = runDiagnosis({
          platform,
          detection,
          dataset: ds,
          target: input,
          productText: product,
          price: validPrice,
        });
        if (res.ok) setReport({ report: res.report, signature });
        else setRunError(res.error);
      } catch (e) {
        setRunError(`计算出错：${(e as Error).message}`);
      } finally {
        setRunning(false);
      }
    }, 20);
  }

  const blockingIssue = dataset?.issues.find((i) => i.level === 'error');
  const canGenerate = !!dataset && !blockingIssue && !!targetInput.input && detection?.missing.length === 0;
  const samplesForPlatform = SAMPLE_LIST.filter((s) => s.platform === platform);

  return (
    <div class="page">
      <header class="masthead">
        <div class="wrap masthead-inner">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true" />
            <span class="brand-name">投流体检</span>
          </div>
          <p class="privacy">
            <LockIcon />
            报表只在你的浏览器里计算，不会上传
          </p>
        </div>
      </header>

      <main class="wrap">
        {route ? (
          <LegalPage doc={route} />
        ) : (
        <>
        <section class="intro">
          <h1>找出广告费里，有统计依据的浪费</h1>
          <p class="lede">上传亚马逊、抖音千川或小红书导出的广告报表。每条结论都会告诉你依据和把握有多大，数据不够时直接说不够。</p>
        </section>

        <section class="step" aria-labelledby="s1">
          <h2 id="s1" class="step-title">
            <span class="step-no">1</span>选择平台
          </h2>
          <div class="segmented" role="radiogroup" aria-label="平台">
            {PLATFORM_ORDER.map((id) => {
              const p = PLATFORMS[id];
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={platform === id}
                  class={`segment ${platform === id ? 'is-active' : ''}`}
                  onClick={() => platform !== id && resetAll(id)}
                >
                  <span class="segment-name">{p.name}</span>
                  <span class="segment-sub">
                    {p.adSystem}
                    {p.beta && <span class="tag tag-beta">测试版</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {meta.beta && (
            <p class="note note-warn">
              {meta.adSystem}官方帮助中心需要登录，还没能拿到真实导出文件核对表头。上传后请仔细核对第 2 步的列映射；如果识别不准，欢迎把脱敏报表发给我们校准。
            </p>
          )}
        </section>

        <section class="step" aria-labelledby="s2">
          <h2 id="s2" class="step-title">
            <span class="step-no">2</span>上传报表
          </h2>
          <div
            class={`dropzone ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) void onFile(f);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xls,.txt,.tsv"
              class="visually-hidden"
              id="file"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) void onFile(f);
                (e.target as HTMLInputElement).value = '';
              }}
            />
            <p class="dropzone-title">{loading ? '正在读取…' : source ? `已载入：${source.name}` : '把报表文件拖到这里'}</p>
            <p class="dropzone-sub">支持 Excel（.xlsx .xls）和 CSV，自动识别 GBK 等编码</p>
            <button type="button" class="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={loading}>
              {source ? '换一个文件' : '选择文件'}
            </button>
          </div>

          <p class="consent small muted">
            上传文件即表示你已阅读并同意<a href="#/terms">《使用协议》</a>。报表默认只在你的浏览器里计算，不会上传，详见<a href="#/privacy">《隐私政策》</a>。
          </p>

          <div class="samples">
            <span class="samples-label">没有报表？先用模拟数据看看效果：</span>
            {samplesForPlatform.map((s) => (
              <button type="button" class="btn btn-link" onClick={() => onSample(s.id)}>
                {s.title}
              </button>
            ))}
          </div>

          <Disclosure summary={`怎么从${meta.adSystem}导出报表`}>
            <ul class="plain-list">
              {meta.presets.map((p) => (
                <li>
                  <strong>{p.name}</strong>：{p.exportHint}
                </li>
              ))}
            </ul>
          </Disclosure>

          {loadError && <p class="note note-error" role="alert">{loadError}</p>}

          {source && detection && (
            <MappingPanel
              source={source}
              detection={detection}
              dataset={dataset}
              platform={platform}
              sym={sym}
              currency={currency}
              onCurrency={setCurrency}
              onPreset={changePreset}
              onMap={(field, col) => {
                setDetection(setMapping(detection, field, col));
                setReport(null);
              }}
            />
          )}
        </section>

        {source && detection && (
          <section class="step" aria-labelledby="s3">
            <h2 id="s3" class="step-title">
              <span class="step-no">3</span>{conversion === 'engagements' ? '参照线' : '成本与目标'}
            </h2>

            {conversion === 'orders' ? (
              <div class="segmented segmented-small" role="radiogroup" aria-label="参照线">
                {(
                  [
                    ['costs', '填成本，算保本线（推荐）'],
                    ['target', meta.metric === 'acos' ? '直接填目标 ACoS' : '直接填目标 ROI'],
                    ['auto', '不填，用账户平均作参照'],
                  ] as [TargetMode, string][]
                ).map(([m, label]) => (
                  <button type="button" role="radio" aria-checked={mode === m} class={`segment ${mode === m ? 'is-active' : ''}`} onClick={() => setMode(m)}>
                    <span class="segment-name">{label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div class="segmented segmented-small" role="radiogroup" aria-label="参照线">
                {(
                  [
                    ['auto', '用账户平均互动成本作参照'],
                    ['target', '填目标互动成本'],
                  ] as [TargetMode, string][]
                ).map(([m, label]) => (
                  <button type="button" role="radio" aria-checked={mode === m} class={`segment ${mode === m ? 'is-active' : ''}`} onClick={() => setMode(m)}>
                    <span class="segment-name">{label}</span>
                  </button>
                ))}
              </div>
            )}

            {mode === 'costs' && conversion === 'orders' && costModel === 'amazon' && (
              <div class="form-grid">
                <NumberField id="a-price" label="售价" prefix={sym} value={amazon.price} onInput={(v) => setAmazon({ ...amazon, price: v })} />
                <NumberField id="a-cost" label="采购及头程成本（每件）" prefix={sym} value={amazon.productCost} onInput={(v) => setAmazon({ ...amazon, productCost: v })} />
                <NumberField id="a-fba" label="FBA 配送费（每件）" prefix={sym} value={amazon.fbaFee} onInput={(v) => setAmazon({ ...amazon, fbaFee: v })} />
                <NumberField id="a-ref" label="销售佣金" suffix="%" value={amazon.referralPct} onInput={(v) => setAmazon({ ...amazon, referralPct: v })} hint="大多数类目是 15%，以你的类目为准" />
                <NumberField id="a-other" label="其他每单成本（选填）" prefix={sym} value={amazon.otherCost} onInput={(v) => setAmazon({ ...amazon, otherCost: v })} hint="仓储、退货损耗、包装等摊到每单" />
              </div>
            )}
            {mode === 'costs' && conversion === 'orders' && costModel === 'domestic' && (
              <div class="form-grid">
                <NumberField id="d-price" label="客单价" prefix={sym} value={domestic.price} onInput={(v) => setDomestic({ ...domestic, price: v })} />
                <NumberField id="d-cost" label="商品成本（每单）" prefix={sym} value={domestic.productCost} onInput={(v) => setDomestic({ ...domestic, productCost: v })} hint="采购、包装、赠品" />
                <NumberField id="d-ship" label="快递费（每单）" prefix={sym} value={domestic.shipping} onInput={(v) => setDomestic({ ...domestic, shipping: v })} />
                <NumberField id="d-plat" label="平台扣点" suffix="%" value={domestic.platformPct} onInput={(v) => setDomestic({ ...domestic, platformPct: v })} hint="以你后台的结算比例为准" />
                <NumberField id="d-comm" label="达人佣金（选填）" suffix="%" value={domestic.commissionPct} onInput={(v) => setDomestic({ ...domestic, commissionPct: v })} />
                <NumberField id="d-ret" label="退货率" suffix="%" value={domestic.returnRatePct} onInput={(v) => setDomestic({ ...domestic, returnRatePct: v })} hint="影响很大，请按真实数据填" />
              </div>
            )}
            {mode === 'target' && (
              <div class="form-grid">
                {conversion === 'engagements' ? (
                  <NumberField id="t-cpe" label="目标互动成本" prefix={sym} value={targetValue} onInput={setTargetValue} />
                ) : meta.metric === 'acos' ? (
                  <NumberField id="t-acos" label="目标 ACoS" suffix="%" value={targetValue} onInput={setTargetValue} hint="广告费占销售额的比例上限" />
                ) : (
                  <NumberField id="t-roi" label="目标 ROI" value={targetValue} onInput={setTargetValue} hint="成交金额 ÷ 广告消耗的下限" />
                )}
              </div>
            )}
            {mode === 'auto' && (
              <p class="note">
                {conversion === 'engagements'
                  ? '以这份报表的平均互动成本作参照，找出明显拖低整体效率的笔记。'
                  : '以这份报表的整体效率作参照，找出明显拖低整体的部分。这不代表盈亏；填写成本后，结论才能回答“是不是在亏钱”。'}
              </p>
            )}

            {breakevenPreview && (
              <div class={`breakeven ${breakevenPreview.error ? 'is-error' : ''}`}>
                {breakevenPreview.error ? (
                  <p>{breakevenPreview.error}</p>
                ) : (
                  <>
                    <p class="breakeven-value">{breakevenPreview.text}</p>
                    <ul class="plain-list small">
                      {breakevenPreview.lines.map((l) => (
                        <li>{l}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {preset?.kind === 'searchTerm' && (
              <label class="field field-wide" for="product">
                <span class="field-label">产品标题和卖点（选填）</span>
                <textarea
                  id="product"
                  rows={3}
                  value={product}
                  placeholder="粘贴产品标题和几条卖点。用来粗判搜索词是否和产品相关，避免把相关的词否掉"
                  onInput={(e) => setProduct((e.target as HTMLTextAreaElement).value)}
                />
              </label>
            )}

            {mode !== 'auto' && targetInput.errors.length > 0 && targetInput.errors.length < 6 && (
              <ul class="plain-list small muted">
                {targetInput.errors.map((e) => (
                  <li>{e}</li>
                ))}
              </ul>
            )}
            {blockingIssue && <p class="note note-error">{blockingIssue.message}</p>}
            {detection.missing.length > 0 && <p class="note note-error">还有必填的列没有指定，请在上面的列映射里选择。</p>}
            {runError && <p class="note note-error" role="alert">{runError}</p>}

            <div class="actions">
              <button type="button" class="btn btn-primary btn-large" disabled={!canGenerate || running} onClick={generate}>
                {running ? '正在计算…' : report ? '重新生成报告' : '生成诊断报告'}
              </button>
            </div>
          </section>
        )}

        {report && (
          <section class="report-section" ref={reportRef} aria-label="诊断报告">
            {stale && (
              <div class="note note-warn stale">
                参数已修改，下面还是旧的结果。
                <button type="button" class="btn btn-link" onClick={generate} disabled={!canGenerate}>
                  用新参数重新生成
                </button>
              </div>
            )}
            <ReportView report={report.report} product={product} />
          </section>
        )}
        </>
        )}
      </main>

      <footer class="footer">
        <div class="wrap">
          <p>投流体检 v0.1，测试版。所有计算在你的浏览器里完成，页面不会向任何服务器发送报表数据。</p>
          <p>结论是基于历史数据的统计判断，不是对未来效果的保证；调整前请结合你对产品和市场的了解。</p>
          <p class="footer-links">
            <a href="#/terms">使用协议</a>
            <a href="#/privacy">隐私政策</a>
            <a href="https://github.com/bulijiojio99/ad-checkup" target="_blank" rel="noopener noreferrer">开源代码</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function MappingPanel(props: {
  source: Source;
  detection: Detection;
  dataset: Dataset | null;
  platform: PlatformId;
  sym: string;
  currency: string | null;
  onCurrency: (c: string | null) => void;
  onPreset: (id: string) => void;
  onMap: (field: FieldKey, col: number | null) => void;
}) {
  const { detection: d, dataset: ds, sym } = props;
  const meta = PLATFORMS[props.platform];
  const requiredKeys = new Set(d.preset.required.flat());
  const missingKeys = new Set(d.missing.flat());
  const headerOptions = d.headers.map((h, i) => ({ i, label: h.trim() ? h.trim() : `第 ${i + 1} 列（无表头）` }));
  const currencies = ds ? Object.keys(ds.currencies) : [];
  const t = ds?.totals;
  const isOrders = d.preset.conversion === 'orders';

  return (
    <div class="panel">
      <div class="panel-head">
        <h3>识别结果</h3>
        <label class="inline-select">
          <span>报表类型</span>
          <select value={d.preset.id} onChange={(e) => props.onPreset((e.target as HTMLSelectElement).value)}>
            {meta.presets.map((p) => (
              <option value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>
      <p class="muted small">
        工作表「{d.sheetName}」第 {d.headerRow + 1} 行是表头{props.source.encoding ? `，文件编码 ${props.source.encoding}` : ''}。
        {props.source.isSample ? '这是模拟数据，表头按公开资料整理。' : ''}
      </p>

      <Disclosure summary={`列映射：已识别 ${d.matches.length} 列${d.missing.length ? `，还缺 ${d.missing.length} 项必填` : ''}`} open={d.missing.length > 0}>
        <div class="mapping">
          {d.preset.fields.map((f) => {
            const col = d.mapping[f.key];
            const isMissing = missingKeys.has(f.key);
            const match = d.matches.find((m) => m.field === f.key);
            return (
              <label class={`mapping-row ${isMissing ? 'is-missing' : ''}`}>
                <span class="mapping-label">
                  {f.label}
                  {requiredKeys.has(f.key) && <span class="tag">{d.preset.required.find((g) => g.includes(f.key))!.length > 1 ? '二选一' : '必填'}</span>}
                </span>
                <select
                  value={col === undefined ? '' : String(col)}
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    props.onMap(f.key, v === '' ? null : Number(v));
                  }}
                >
                  <option value="">（不使用）</option>
                  {headerOptions.map((o) => (
                    <option value={String(o.i)}>{o.label}</option>
                  ))}
                </select>
                <span class="mapping-status">{match ? (match.via === 'manual' ? '手动指定' : '自动识别') : isMissing ? '未识别' : ''}</span>
              </label>
            );
          })}
        </div>
      </Disclosure>

      {ds && t && (
        <div class="check">
          <p class="check-title">请先核对：这些合计数应该和你后台看到的一致</p>
          <dl class="stats">
            <div>
              <dt>数据行</dt>
              <dd>{int(ds.rows.length)}</dd>
            </div>
            {ds.period && (
              <div>
                <dt>日期范围</dt>
                <dd>
                  {ds.period.start} 至 {ds.period.end}
                </dd>
              </div>
            )}
            <div>
              <dt>总花费</dt>
              <dd>{money(t.spend, sym)}</dd>
            </div>
            {t.clicks !== null && (
              <div>
                <dt>点击</dt>
                <dd>{int(t.clicks)}</dd>
              </div>
            )}
            {isOrders ? (
              <>
                <div>
                  <dt>订单</dt>
                  <dd>{int(t.orders)}</dd>
                </div>
                <div>
                  <dt>销售额</dt>
                  <dd>{money(t.sales, sym)}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>互动</dt>
                <dd>{int(t.engagements)}</dd>
              </div>
            )}
          </dl>
          {currencies.length > 1 && (
            <label class="inline-select">
              <span>只分析这种货币</span>
              <select value={props.currency ?? ds.currency ?? ''} onChange={(e) => props.onCurrency((e.target as HTMLSelectElement).value)}>
                {currencies.map((c) => (
                  <option value={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          {ds.issues.length > 0 && (
            <ul class="issues">
              {ds.issues.map((i) => (
                <li class={`issue issue-${i.level}`}>{i.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
