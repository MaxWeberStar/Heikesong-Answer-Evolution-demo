// app/api/profile/route.ts — 答案画像接口（两层分类，PRD 4.1.2 / 9.3）
// 输入：一组 RawAnswer（或直接给 topic 由本接口先取数）；输出：AnswerProfile[] + categories
import { NextRequest, NextResponse } from "next/server";
import { searchZhihu, searchZhihuMulti, topByVotes } from "@/lib/zhihu";
import { categorizeQuestions, profileAnswers } from "@/lib/profile";
import { withCache } from "@/lib/cache";
import { llmEnabled } from "@/lib/llm";
import {
  attachAnswerRelevance,
  buildQueryPlan,
  rankAnswersByRelevance,
  type QueryPlan,
  type RelevanceResult,
} from "@/lib/query-relevance";
import type { RawAnswer } from "@/types";

/** 话题的近义 query 变体：多 query 累积到 50-100 条（PRD 9.2 / TDD 2.1） */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const bodyIn = await req.json().catch(() => ({}));
    const topic: string = bodyIn.topic || "";
    const passedAnswers: RawAnswer[] = Array.isArray(bodyIn.answers) ? bodyIn.answers : [];
    const topN = Number(bodyIn.top || 10);

    // corpus = 取到的完整语料（用于统计"拉取 ≥50 条"）；toProfile = 实际画像的 Top N（控 LLM 成本）
    let corpus: RawAnswer[] = [];
    let queryPlan: QueryPlan | null = null;
    let relevanceById = new Map<string, RelevanceResult>();

    if (!passedAnswers.length) {
      if (!topic)
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "需要 topic 或 answers" },
          { status: 400 }
        );
      // 关键词入口：多 query 累积到 50-100 条（PRD 9.2 / 验收第 1 条 ≥50）；单 query 结果太少时兜底
      queryPlan = buildQueryPlan(topic);
      const { value } = await withCache(`search:${topic}:multi:relevance-v1`, 60 * 60 * 1000, () =>
        searchZhihuMulti(queryPlan?.queries || [topic])
      );
      const ranked = rankAnswersByRelevance(value, queryPlan);
      corpus = ranked;
      relevanceById = new Map(ranked.map((answer) => [answer.id, answer.relevance]));
      // 极端情况下 multi 也很少 → 再补一次单 query
      if (corpus.length < 10) {
        try {
          const single = await searchZhihu(topic, 10);
          const seen = new Set(corpus.map((a) => a.url || a.id));
          const rankedSingle = rankAnswersByRelevance(single, queryPlan);
          for (const a of rankedSingle) {
            if (!seen.has(a.url || a.id)) {
              corpus.push(a);
              relevanceById.set(a.id, a.relevance);
            }
          }
        } catch { /* 忽略兜底失败 */ }
      }
    } else {
      // 问题帖入口：传入的已是 collect 翻页取到的完整回答集
      corpus = passedAnswers;
      relevanceById = new Map(
        corpus.map((answer) => [
          answer.id,
          { tier: "core", score: 1, matchedTerms: [], reason: "指定问题帖内回答" },
        ])
      );
    }

    const toProfile = passedAnswers.length ? topByVotes(corpus, topN) : corpus.slice(0, topN);
    const corpusTotal = corpus.length;
    const coreMatches = toProfile.filter((answer) => relevanceById.get(answer.id)?.tier === "core").length;
    const extendedMatches = toProfile.length - coreMatches;
    const collectedCoreMatches = Array.from(relevanceById.values()).filter((item) => item.tier === "core").length;
    const collectedExtendedMatches = Array.from(relevanceById.values()).filter((item) => item.tier === "extended").length;

    // 画像结果缓存（key 含 topic + LLM 开关 + 语料量，避免降级/正式版混淆）
    const { value: result, cached } = await withCache(
      `profile:${topic || "adhoc"}:${llmEnabled() ? "llm" : "rule"}:relevance-v3:${corpusTotal}:${toProfile.length}`,
      6 * 60 * 60 * 1000,
      async () => {
        const categories = await categorizeQuestions(corpus);
        const profiles = attachAnswerRelevance(await profileAnswers(toProfile, categories), relevanceById);
        // 统计
        const bySourceType: Record<string, number> = {};
        for (const p of profiles)
          bySourceType[p.sourceType] = (bySourceType[p.sourceType] || 0) + 1;
        const times = profiles.map((p) => p.postTime).filter(Boolean).sort();
        return {
          categories,
          answers: profiles,
          stats: {
            collected: corpusTotal, // 累积取到的语料条数（验收：≥50）
            profiled: profiles.length, // 实际画像条数（Top N）
            total: profiles.length,
            coreMatches,
            extendedMatches,
            collectedCoreMatches,
            collectedExtendedMatches,
            normalizedQuery: queryPlan?.normalized || "",
            queryTerms: queryPlan?.terms || [],
            querySubject: queryPlan?.subject || "",
            queryIntent: queryPlan?.intent || "",
            queryIgnoredTerms: queryPlan?.ignoredTerms || [],
            queryExplanation: queryPlan?.explanation || "",
            longQuery: queryPlan?.isLong || false,
            bySourceType,
            timeSpan: times.length
              ? { from: times[0], to: times[times.length - 1] }
              : undefined,
          },
        };
      }
    );

    return NextResponse.json({
      topic,
      llm: llmEnabled(),
      cached,
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "INTERNAL", message: (e as Error).message },
      { status: 500 }
    );
  }
}
