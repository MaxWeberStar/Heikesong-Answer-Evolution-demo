import type { RawAnswer, AnswerProfile } from "@/types";

export type RelevanceTier = "core" | "extended";

export interface QueryPlan {
  original: string;
  normalized: string;
  terms: string[];
  subject: string;
  intent: string;
  ignoredTerms: string[];
  explanation: string;
  queries: string[];
  isLong: boolean;
}

export interface RelevanceResult {
  tier: RelevanceTier;
  score: number;
  matchedTerms: string[];
  reason: string;
}

const STOP_WORDS = new Set([
  "如果", "我有", "庞大", "各种", "要", "了", "中国", "达到", "发生",
  "为什么", "什么", "怎么", "如何", "哪些", "很多", "有人", "人们", "一个", "这个",
  "那个", "工作几年后", "几年后", "产生", "应该", "重新", "建立", "以及", "并且",
  "是否", "可以", "怎样", "什么样", "到底", "到底是", "会对", "之后", "时候",
  "经历", "问题", "标准", "影响", "原因", "方法", "看待", "普通人",
]);

export function buildQueryPlan(input: string): QueryPlan {
  const original = input.trim();
  const isLong = original.length > 18;
  const extracted = extractTerms(original);
  const intentMatch = original.match(/创业|变现|商业化|做产品|开公司|生意/);
  const dataMatch = original.match(/数据|资料|样本|用户信息/);
  const peopleMatch = original.match(/中国人|人口|用户|消费者|人群/);
  const scenarioMatch = original.match(/各种场景|场景数据|使用场景|生活场景/);
  const intent = intentMatch?.[0] || "探索问题";
  const subject = dataMatch ? `${peopleMatch?.[0] || "用户"}${scenarioMatch ? "场景数据" : "数据"}` : extracted.slice(0, 2).join(" ");
  const topic = dataMatch && intentMatch ? `数据${intent}` : extracted.slice(0, 2).join("");
  const terms = uniqueQueries([
    intentMatch?.[0] || "",
    dataMatch?.[0] || "",
    scenarioMatch ? "场景数据" : "",
    ...extracted.filter((term) => !["中国人", "庞大", "各种", "场景"].includes(term)).slice(0, 3),
  ]);
  const ignoredTerms = uniqueQueries(
    extracted.filter((term) => ["中国人", "庞大", "各种", "场景"].includes(term))
  );
  const normalized = `主题：${topic || "待确认"}；对象：${subject || "待确认"}；意图：${intent}`;
  const explanation = `系统将这句话理解为：围绕「${subject || "待确认对象"}」探索「${intent}」问题；${ignoredTerms.length ? `「${ignoredTerms.join("、")}」仅作为背景词，不单独决定相关性。` : "未发现需要单独降权的泛词。"}`;

  if (!isLong) {
    return {
      original,
      normalized: original,
      terms: terms.length ? terms : [original],
      subject: subject || original,
      intent,
      ignoredTerms,
      explanation,
      queries: [original, `${original} 是什么`, `如何看待${original}`, `${original} 为什么`, `${original} 经历`],
      isLong,
    };
  }

  const focus = terms.slice(0, 6);
  const primary = focus.join(" ");
  const queries = uniqueQueries([
    primary,
    `${subject} ${intent}`,
    `${topic} ${intent}`,
    `${subject} 案例`,
    `${intent} ${dataMatch ? "数据" : ""}`,
  ]);

  return { original, normalized, terms: focus, subject, intent, ignoredTerms, explanation, queries, isLong };
}

export function rankAnswersByRelevance(
  answers: RawAnswer[],
  plan: QueryPlan
): Array<RawAnswer & { relevance: RelevanceResult }> {
  return answers
    .map((answer) => ({ ...answer, relevance: scoreAnswer(answer, plan) }))
    .sort((a, b) => {
      if (a.relevance.tier !== b.relevance.tier) return a.relevance.tier === "core" ? -1 : 1;
      if (b.relevance.score !== a.relevance.score) return b.relevance.score - a.relevance.score;
      return b.voteUpCount - a.voteUpCount;
    });
}

export function attachAnswerRelevance(
  profiles: AnswerProfile[],
  relevanceById: Map<string, RelevanceResult>
): AnswerProfile[] {
  return profiles.map((profile) => {
    const relevance = relevanceById.get(profile.id);
    if (!relevance) return profile;
    return {
      ...profile,
      relevanceTier: relevance.tier,
      relevanceScore: relevance.score,
      relevanceReason: relevance.reason,
    };
  });
}

export function extractTerms(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .replace(/[“”"'‘’！!？，。、：:；;（）()【】《》<>「」\[\]…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale: string, options: { granularity: "word" }) => {
      segment(value: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;
  const segments = Segmenter
    ? Array.from(new Segmenter("zh", { granularity: "word" }).segment(normalized), (item) => item.segment)
    : normalized.split(/\s+/);

  const terms: string[] = [];
  let singles = "";
  const flushSingles = () => {
    if (singles.length >= 2 && !STOP_WORDS.has(singles)) terms.push(singles);
    singles = "";
  };

  for (const raw of segments) {
    const token = raw.trim();
    if (!token || STOP_WORDS.has(token) || /^\d+$/.test(token)) continue;
    if (/^[\u4e00-\u9fff]$/.test(token)) {
      singles += token;
      continue;
    }
    flushSingles();
    if (token.length >= 2 || /[a-z0-9]/i.test(token)) terms.push(token);
  }
  flushSingles();

  return Array.from(new Set(terms)).filter((term) => !STOP_WORDS.has(term));
}

function scoreAnswer(answer: RawAnswer, plan: QueryPlan): RelevanceResult {
  const haystack = `${answer.title} ${answer.contentText}`.toLowerCase();
  const matchedTerms = plan.terms.filter((term) => haystack.includes(term.toLowerCase()));
  const totalWeight = plan.terms.reduce((sum, term) => sum + Math.max(term.length, 1), 0) || 1;
  const matchedWeight = matchedTerms.reduce((sum, term) => sum + Math.max(term.length, 1), 0);
  const exactPhrase = plan.normalized && haystack.includes(plan.normalized.replace(/\s+/g, ""));
  const score = Math.min(1, (matchedWeight / totalWeight) + (exactPhrase ? 0.2 : 0));
  const tier: RelevanceTier = !plan.isLong || score >= 0.55 ? "core" : "extended";

  return {
    tier,
    score: Number(score.toFixed(3)),
    matchedTerms,
    reason: matchedTerms.length
      ? `${tier === "core" ? "核心结果" : "扩展阅读"}，命中：${matchedTerms.slice(0, 4).join("、")}`
      : "扩展阅读，未充分命中核心词",
  };
}

function uniqueQueries(queries: string[]): string[] {
  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}
