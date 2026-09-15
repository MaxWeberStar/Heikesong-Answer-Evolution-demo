// app/api/evolution/route.ts — 真实版演进卡片接口
import { NextRequest, NextResponse } from "next/server";
import { analyzeEvolution } from "@/lib/evolution";
import { searchZhihu, topByVotes } from "@/lib/zhihu";
import { categorizeQuestions, profileAnswers } from "@/lib/profile";
import { withCache } from "@/lib/cache";
import { llmEnabled } from "@/lib/llm";
import type { AnswerProfile } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const topic: string = body.topic || "";
    let profiles: AnswerProfile[] = Array.isArray(body.answers) ? body.answers : [];

    // 若未传画像，则取数并画像
    if (!profiles.length) {
      if (!topic)
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "需要 topic 或 answers" },
          { status: 400 }
        );
      const { value: raws } = await withCache(`search:${topic}:single`, 60 * 60 * 1000, () =>
        searchZhihu(topic, 10)
      );
      const top = topByVotes(raws, 10);
      const cats = await categorizeQuestions(top);
      profiles = await profileAnswers(top, cats);
    }

    const { value: result, cached } = await withCache(
      `evolution:${topic || "adhoc"}:${llmEnabled() ? "llm" : "rule"}:layers-v2:${profiles.length}`,
      6 * 60 * 60 * 1000,
      () => analyzeEvolution(topic, profiles)
    );

    return NextResponse.json({ cached, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: "INTERNAL", message: (e as Error).message },
      { status: 500 }
    );
  }
}
