// lib/profile.ts — 答案画像：两层分类（PRD 9.3）+ 无 key 规则降级
import { chat, parseJson, llmEnabled } from "@/lib/llm";
import type { RawAnswer, AnswerProfile, QuestionCategory } from "@/types";

const BASE_TYPES = ["生活经验型", "理论溯源型", "社会共识型", "心理机制型"];

/** 第一层：对问题标题做维度聚类（LLM；降级=按标题去重分组） */
export async function categorizeQuestions(
  answers: RawAnswer[]
): Promise<QuestionCategory[]> {
  const titles = Array.from(new Set(answers.map((a) => a.title))).slice(0, 30);
  if (llmEnabled() && titles.length) {
    try {
      const out = await chat(
        `以下是知乎同一话题下的若干问题标题。请按“问题维度”归纳成 3-6 个类别（如概念理解/情感关系/职场金钱等），类别数视话题丰富度而定，最多 6 个。\n` +
          `标题：\n${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n` +
          `只输出 JSON：{"categories":[{"name":"...","description":"..."}]}`,
        { json: true, maxTokens: 400 }
      );
      const j = parseJson<{ categories: QuestionCategory[] }>(out);
      if (j?.categories?.length) return j.categories;
    } catch {
      /* 降级 */
    }
  }
  // 降级：单一类别
  return [{ name: "全部问题", description: "未启用 LLM，未做问题维度聚类" }];
}

/** 第二层：逐条答案画像。批处理，控制 token。 */
export async function profileAnswers(
  answers: RawAnswer[],
  categories: QuestionCategory[]
): Promise<AnswerProfile[]> {
  const catNames = categories.map((c) => c.name).join(" / ");
  const results: AnswerProfile[] = [];

  if (!llmEnabled()) {
    return answers.map((a) => ruleProfile(a));
  }

  // 每批 5 条，降低单次 token
  for (let i = 0; i < answers.length; i += 5) {
    const batch = answers.slice(i, i + 5);
    try {
      const out = await chat(
        `你是观点分析助手。对每条知乎回答做画像。\n` +
          `来源类型固定四类兜底：${BASE_TYPES.join("、")}；如明显不属于可新增 1 个专属标签。\n` +
          `问题维度候选：${catNames}。\n` +
          `回答列表（id + 摘要）：\n` +
          batch
            .map((a) => `[${a.id}] 标题:${a.title}\n摘要:${a.contentText.slice(0, 500)}`)
            .join("\n---\n") +
          `\n只输出 JSON：{"items":[{"id":"...","claim":"一句核心主张","sourceType":"...","school":"派别/学科","stance":"立场","keywords":["..."],"argumentStyle":"讲道理|举例|引用","questionCategory":"...","originText":"提到的理论/事件(无则空)"}]}`,
        { json: true, maxTokens: 1200 }
      );
      const j = parseJson<{ items: any[] }>(out);
      const map = new Map((j?.items || []).map((x) => [String(x.id), x]));
      for (const a of batch) {
        const p = map.get(a.id);
        results.push(p ? mergeProfile(a, p) : ruleProfile(a));
      }
    } catch {
      for (const a of batch) results.push(ruleProfile(a));
    }
  }
  return results;
}

function mergeProfile(a: RawAnswer, p: any): AnswerProfile {
  return {
    id: a.id,
    sourceTitle: a.title,
    claim: p.claim || a.title || (a.contentText || "").split(/[。！？\n]/)[0].slice(0, 60) || "（无摘要）",
    sourceType: p.sourceType || "未分类",
    school: p.school || "",
    stance: p.stance || "",
    keywords: Array.isArray(p.keywords) ? p.keywords.slice(0, 5) : [],
    argumentStyle: p.argumentStyle || "讲道理",
    originEvent: p.originText ? { text: p.originText, verified: false } : undefined,
    postTime: toDate(a.editTime),
    postTimeSource: a.editTimeSource || "unknown",
    votes: a.voteUpCount,
    comments: a.commentCount,
    author: a.authorName,
    authorBadge: a.authorBadge,
    url: a.url,
    contentType: a.contentType,
    questionCategory: p.questionCategory || undefined,
  };
}

/** 规则版画像（无 LLM 时）：关键词粗分类 + 原始字段 */
function ruleProfile(a: RawAnswer): AnswerProfile {
  const t = (a.title + a.contentText).toLowerCase();
  let sourceType = "未分类";
  if (/韦伯|理论|哲学|社会学|概念|定义/.test(t)) sourceType = "理论溯源型";
  else if (/心理|情绪|光环|认知|焦虑/.test(t)) sourceType = "心理机制型";
  else if (/大家|社会|时代|共识|草台班子/.test(t)) sourceType = "社会共识型";
  else sourceType = "生活经验型";
  // 问题帖回答无 title，用 Summary 前一句兜底为 claim
  const fallbackClaim = a.title || (a.contentText || "").split(/[。！？\n]/)[0].slice(0, 60) || "（无摘要）";
  return {
    id: a.id,
    sourceTitle: a.title,
    claim: fallbackClaim,
    sourceType,
    school: "",
    stance: "",
    keywords: [],
    argumentStyle: "讲道理",
    postTime: toDate(a.editTime),
    postTimeSource: a.editTimeSource || "unknown",
    votes: a.voteUpCount,
    comments: a.commentCount,
    author: a.authorName,
    authorBadge: a.authorBadge,
    url: a.url,
    contentType: a.contentType,
  };
}

function toDate(ts: number): string {
  return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
}
