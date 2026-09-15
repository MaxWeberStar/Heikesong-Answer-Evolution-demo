// app/api/cluster/route.ts — P1 观点谱系仪接口（PRD 4.2 / TDD 5）
// 输入：AnswerProfile[]（或 topic 自取数画像）；输出：GenealogyResult（簇 + 2D 点 + 两轴）
import { NextRequest, NextResponse } from "next/server";
import { analyzeGenealogy } from "@/lib/cluster";
import { searchZhihuMulti, topByVotes } from "@/lib/zhihu";
import { categorizeQuestions, profileAnswers } from "@/lib/profile";
import { withCache } from "@/lib/cache";
import { llmEnabled } from "@/lib/llm";
import { embedEnabled } from "@/lib/embed";
import type { AnswerProfile } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const topic: string = body.topic || "";
    let profiles: AnswerProfile[] = Array.isArray(body.answers) ? body.answers : [];

    // 若未传画像，则按 topic 取数并画像
    if (!profiles.length) {
      if (!topic)
        return NextResponse.json({ error: "BAD_REQUEST", message: "需要 topic 或 answers" }, { status: 400 });
      const { value: raws } = await withCache(`search:${topic}:multi`, 60 * 60 * 1000, () =>
        searchZhihuMulti([topic, `${topic} 是什么`, `如何看待${topic}`, `${topic} 为什么`])
      );
      const top = topByVotes(raws, 12);
      const cats = await categorizeQuestions(top);
      profiles = await profileAnswers(top, cats);
    }

    const { value: result, cached } = await withCache(
      `cluster:${topic || "adhoc"}:${embedEnabled() ? "emb" : llmEnabled() ? "llm" : "rule"}:layers-v2:${profiles.length}`,
      6 * 60 * 60 * 1000,
      () => analyzeGenealogy(topic, profiles)
    );

    return NextResponse.json({ topic, cached, ...result });
  } catch (e) {
    return NextResponse.json({ error: "INTERNAL", message: (e as Error).message }, { status: 500 });
  }
}
