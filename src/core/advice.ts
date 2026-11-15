/**
 * 改善建议的写法。原则：
 *   1. 针对这一行：引用它自己的花费、点击、转化和效率，说明和参照线差多少；
 *   2. 说出可能的原因：哪个词不在产品描述里、由哪个关键词或哪种投放带来；
 *   3. 语气客观，不把话说死：用“可以考虑”“建议先……再……”，不用“必须”“一定”“直接”；
 *   4. 给出替代方案和复查条件，证据不足时明确说不确定。
 * text 是表格里的一句话建议，detail 是展开后的具体说明。
 */
import { money, pct, prob, ratio } from './format';
import type { Action, ConversionKind, Evidence, PlatformId, ReportKind, Row, Tier } from './types';
import type { Target } from './analyze';

export interface RelevanceInfo {
  level: 'related' | 'partial' | 'unrelated';
  /** 搜索词里没有出现在产品描述中的词 */
  missing: string[];
}

export interface AdviceInput {
  platform: PlatformId;
  kind: ReportKind;
  conversion: ConversionKind;
  tier: Tier;
  k: number;
  row: Row;
  evidence: Evidence;
  target: Target;
  relevance: RelevanceInfo | null;
  isAsin: boolean;
  exactConflict: boolean;
  suggestedBid: number | undefined;
  sym: string;
}

const MATCH_LABEL: Record<string, string> = { broad: '广泛匹配', phrase: '词组匹配', exact: '精准匹配' };

function negLabel(platform: PlatformId): string {
  if (platform === 'amazon') return '否定精准（negative exact）';
  if (platform === 'douyin') return '否定词';
  return '否定关键词';
}

const quote = (words: string[]) => words.map((w) => `“${w}”`).join('');

/** 这一行的效率和参照线，用卖家习惯的口径（亚马逊 ACoS，国内 ROI，种草看互动成本） */
function effText(a: AdviceInput) {
  const r = a.row;
  const t = a.target;
  const refWord = t.source === 'breakeven' ? '保本线' : t.source === 'accountAverage' ? '账户平均' : '目标';
  if (a.conversion === 'engagements') {
    const now = a.k > 0 ? r.spend / a.k : null;
    return {
      now: now !== null ? `互动成本 ${money(now, a.sym)}` : '还没有互动',
      ref: `${refWord}（${money(t.cpe, a.sym)}）`,
      times: now !== null && t.cpe ? now / t.cpe : null,
      worse: '高于',
    };
  }
  if (a.platform === 'amazon') {
    return {
      now: r.sales > 0 ? `ACoS ${pct(r.spend / r.sales)}` : '还没有销售额',
      ref: `${refWord}（ACoS ${pct(t.acos)}）`,
      times: null,
      worse: '高于',
    };
  }
  return {
    now: r.sales > 0 ? `ROI ${ratio(r.sales / r.spend)}` : '还没有成交',
    ref: `${refWord}（ROI ${ratio(t.acos ? 1 / t.acos : null)}）`,
    times: null,
    worse: '低于',
  };
}

/** 这个搜索词是怎么来的：由哪个关键词、哪种匹配方式，或自动广告、商品投放 */
function sourceOf(a: AdviceInput): { text: string; broadKeyword: string | null } {
  const term = (a.row.term ?? a.row.name).toLowerCase();
  const kw = a.row.targetings.find((t) => (t.matchType === 'broad' || t.matchType === 'phrase') && t.text && t.text.toLowerCase() !== term);
  if (kw) return { text: `它由${MATCH_LABEL[kw.matchType]}关键词“${kw.text}”触发`, broadKeyword: kw.matchType === 'broad' ? kw.text : null };
  const auto = a.row.targetings.find((t) => t.matchType === 'auto');
  if (auto) return { text: `它来自自动广告${auto.text && auto.text !== '*' ? `（${auto.text}）` : ''}`, broadKeyword: null };
  if (a.row.targetings.some((t) => t.matchType === 'product')) return { text: '它来自商品投放', broadKeyword: null };
  return { text: '', broadKeyword: null };
}

function relevanceText(rel: RelevanceInfo | null): string {
  if (!rel) return '';
  if (rel.level === 'unrelated') return '搜索词里的词都没有出现在你的产品描述中，可能和产品不相关';
  if (rel.level === 'partial' && rel.missing.length) return `其中${quote(rel.missing)}没有出现在你的产品描述里，买家要找的可能不是同一款产品`;
  if (rel.level === 'related') return '搜索词和你的产品描述基本吻合，问题可能不在词本身';
  return '';
}

const join = (parts: string[]) => parts.filter(Boolean).join('；') + '。';

export function writeAdvice(a: AdviceInput): Action {
  const { tier, k, row: r, evidence: e, sym } = a;
  const eff = effText(a);
  const n = r.clicks ?? 0;
  const cpc = e.costPerClick;
  const need = e.needMoreClicks !== null && e.needMoreClicks > 0 ? Math.ceil(e.needMoreClicks) : null;
  const needSpend = e.needMoreSpend !== null && e.needMoreSpend > 0 ? e.needMoreSpend : null;
  const recheck = need ? `大约再积累 ${need} 次点击后复查` : needSpend ? `大约再花 ${money(needSpend, sym)} 后复查` : '一到两周后复查';

  if (tier === 'untested') return { code: 'none', text: '缺少客单价或参照线，或者数值异常（例如负数），暂时无法判断' };

  if (tier === 'ok') {
    return { code: 'keep', text: `目前 ${eff.now}，没有发现明显问题，可以保持现状`, detail: `和${eff.ref}相比没有明显偏差，暂不需要调整。` };
  }

  if (tier === 'insufficient') {
    if (k === 0) {
      return {
        code: 'watch',
        text: `点击 ${n || '较少'}${n ? ' 次' : ''}、还没有转化，数据不够判断，暂不建议调整`,
        detail: join([`现在下结论容易冤枉一个本来可以出单的词`, recheck]),
      };
    }
    return {
      code: 'watch',
      text: `目前 ${eff.now}，低于${eff.ref}，但${a.conversion === 'orders' ? '单数' : '互动数'}较少，可能只是波动，建议先观察`,
      detail: join([`${k} ${a.conversion === 'orders' ? '单' : '次互动'}还不足以确认效率偏低`, '一到两周后数据更多时再看是否需要调整']),
    };
  }

  // —— 计划 / 素材 / 笔记 ——
  if (a.kind === 'unit') {
    const spendText = `花费 ${money(r.spend, sym)}`;
    if (a.conversion === 'engagements') {
      const times = eff.times !== null ? `，约为账户平均的 ${ratio(eff.times, 1)} 倍` : '';
      if (tier === 'loss') {
        return {
          code: 'cutUnit',
          text: `${eff.now}${times}，可以考虑减少或停止加热这篇笔记`,
          detail: join([`${spendText}、${k} 次互动，效率明显低于${eff.ref}`, '如果内容方向是对的，也可以参考互动好的笔记，换封面和标题后小预算再测一次']),
        };
      }
      if (tier === 'suspect') {
        return { code: 'lowerBidWatch', text: `${eff.now}，略差于${eff.ref}，证据还不够，可以先收紧预算观察`, detail: join(['偏差可能是正常波动', '观察 3–5 天再决定是否停止加热']) };
      }
      return {
        code: 'scaleUp',
        text: `${eff.now}，明显低于${eff.ref}，值得考虑追加加热预算`,
        detail: join([`${spendText} 带来 ${k} 次互动`, '加预算后留意互动成本是否随之上升，逐步加量比一次加满更稳']),
      };
    }
    if (tier === 'loss') {
      if (k === 0) {
        return {
          code: 'cutUnit',
          text: `${spendText} 还没有成交，可以考虑暂停，或更换素材后小预算重新测试`,
          detail: join([`按${eff.ref}，这笔花费原本应带来约 ${(e.expected ?? 0).toFixed(1)} 单`, '如果刚上线不久，也可以先看看前几天是否有起量迹象']),
        };
      }
      const be = a.target.acos ? 1 / a.target.acos : null;
      const how =
        a.platform === 'douyin'
          ? `可以考虑把 ROI 目标调到 ${ratio(be)} 以上或下调出价`
          : a.platform === 'xiaohongshu'
            ? '可以考虑下调出价或预算，或参考表现好的笔记更换封面和标题'
            : '可以考虑下调出价或预算';
      return {
        code: 'cutUnit',
        text: `${eff.now}，低于${eff.ref}；${how}`,
        detail: join([`${spendText}、${k} 单`, '调整后观察几天，如果仍低于保本线，再考虑暂停或换素材', a.platform === 'douyin' ? '保本线已按你填写的退货率计算' : '']),
      };
    }
    if (tier === 'suspect') {
      return {
        code: 'lowerBidWatch',
        text: `${eff.now}，略低于${eff.ref}，证据还不够，可以适当收紧出价或预算观察`,
        detail: join([`在能达到参照线的前提下，出现这种结果的概率约 ${prob(e.pLoss)}`, '观察 3–5 天再决定']),
      };
    }
    return {
      code: 'scaleUp',
      text: `${eff.now}，好于${eff.ref}，可以考虑逐步加预算`,
      detail: join([`${spendText}、${k} 单`, '建议每次加 20% 左右，并留意加量后 ROI 是否回落']),
    };
  }

  // —— 搜索词 / 关键词 ——
  const src = sourceOf(a);
  const rel = relevanceText(a.relevance);
  const facts = `花费 ${money(r.spend, sym)}、点击 ${n} 次`;

  if (tier === 'loss' && k === 0) {
    const reasons = [`${facts}仍未出单`, src.text, rel];
    if (a.isAsin) {
      return { code: 'negateAsin', text: '可以考虑否定这个商品投放（ASIN），这个商品页面带来的点击一直没有转化', detail: join(reasons) };
    }
    if (a.exactConflict) {
      return {
        code: 'pauseKeyword',
        text: '这是精准关键词本身，否定会让它停止投放；建议先下调出价，仍不出单再考虑暂停',
        detail: join([...reasons, '如果它是你的核心词，也可以先检查价格、主图和评价']),
      };
    }
    if (r.isKeyword) {
      return a.relevance?.level === 'related'
        ? { code: 'lowerBidRelated', text: '和产品相关却还没出单，建议先下调出价并检查价格、主图和评价，暂不建议暂停', detail: join(reasons) }
        : { code: 'pauseKeyword', text: '可以考虑暂停这个关键词，或明显下调出价', detail: join([...reasons, '暂停前可以确认一下它是不是你想覆盖的人群']) };
    }
    if (a.relevance?.level === 'related') {
      return {
        code: 'lowerBidRelated',
        text: '暂不建议否定：先适当下调出价，并检查价格、主图和评价是否有竞争力',
        detail: join([...reasons, '否定一个相关的词，可能会丢掉本来能转化的流量']),
      };
    }
    const confirm =
      a.relevance === null
        ? '；否定前请确认它和你的产品确实无关'
        : a.relevance.level === 'partial' && a.relevance.missing.length
          ? `；否定前请确认${quote(a.relevance.missing)}确实不是你的目标人群或规格`
          : '';
    const tip = src.broadKeyword ? `如果同类无效词较多，也可以考虑把“${src.broadKeyword}”从广泛匹配改为词组匹配，减少类似流量` : '';
    return { code: 'negate', text: `建议考虑加为${negLabel(a.platform)}${confirm}`, detail: join([...reasons, tip]) };
  }

  if (tier === 'loss') {
    const reasons = [`${n} 次点击 ${k} 单，${eff.now}，${eff.worse}${eff.ref}`, src.text];
    const sb = a.suggestedBid;
    if (sb !== undefined && cpc !== null && sb < cpc * 0.4) {
      return {
        code: 'lowerBid',
        text: `按目前的转化水平，点击单价要降到约 ${money(sb, sym)}（目前 ${money(cpc, sym)}）才可能持平，降幅较大；可以优先考虑否定或暂停`,
        detail: join([...reasons, `大幅降价后可能拿不到展示；如果这是你的重点词，可以先检查${a.platform === 'amazon' ? ' Listing ' : '商品详情页'}和价格再决定`])
        , suggestedBid: sb,
      };
    }
    if (sb !== undefined && cpc !== null && sb < cpc) {
      return {
        code: 'lowerBid',
        text: `可以考虑把点击单价逐步降到 ${money(sb, sym)} 附近（目前 ${money(cpc, sym)}），观察一到两周`,
        detail: join([...reasons, '降价后仍达不到参照线，再考虑否定']),
        suggestedBid: sb,
      };
    }
    return { code: 'lowerBid', text: '转化偏低，可以先下调出价 10%–20% 观察', detail: join([...reasons, '同时可以检查这个词对应的商品页面']) };
  }

  if (tier === 'suspect') {
    if (k === 0) {
      return {
        code: 'lowerBidWatch',
        text: `有不出单的迹象，但证据还不够；可以先把出价下调 10%–20%，${recheck}`,
        detail: join([`${facts}还没有出单`, `在能达到参照线的前提下，出现这种结果的概率约 ${prob(e.pLoss)}，还不足以确认`, src.text, rel]),
      };
    }
    return {
      code: 'lowerBidWatch',
      text: `${eff.now}，偏离${eff.ref}，但单数还少；可以小幅下调出价观察，暂不建议否定`,
      detail: join([`${n} 次点击 ${k} 单`, src.text]),
    };
  }

  // win
  const small = n < 20 ? '（样本还少，先小幅调整）' : '';
  const cap = a.suggestedBid !== undefined ? `；按目前的转化水平，点击单价上限约 ${money(a.suggestedBid, sym)}` : '';
  const nonExact = r.targetings.some((t) => t.matchType !== 'exact');
  const facts2 = `${n} 次点击 ${k} 单，${eff.now}，明显好于${eff.ref}`;
  if (a.platform === 'amazon' && !r.isKeyword && nonExact && !a.exactConflict) {
    return {
      code: 'harvestExact',
      text: `表现很好，可以考虑单独建一个精准匹配投放，方便单独控制出价${small}`,
      detail: join([facts2, src.text, cap.replace(/^；/, '')]),
      suggestedBid: a.suggestedBid,
    };
  }
  return {
    code: 'raiseBid',
    text: `表现很好，可以考虑逐步提高出价（每次 10% 左右）${small}`,
    detail: join([facts2, cap.replace(/^；/, ''), '加价后留意排名和效率的变化']),
    suggestedBid: a.suggestedBid,
  };
}
