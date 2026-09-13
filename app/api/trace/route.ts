// app/api/trace/route.ts — 溯源核实接口（PRD 4.1.2 / TDD 4.2）
// 输入：AnswerProfile[]（或 concepts 数组）；输出：OriginAnchor[]
import { NextRequest, NextResponse } from "next/server";
import { collectConcepts, traceConcepts } from "@/lib/trace";
import { withCache } from "@/lib/cache";
import { llmEnabled } from "@/lib/llm";
import type { AnswerProfile } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const topic: string = body.topic || "adhoc";
    let concepts: string[] = Array.isArray(body.concepts) ? body.concepts : [];

    if (!concepts.length) {
      const profiles: AnswerProfile[] = Array.isArray(body.answers) ? body.answers : [];
      concepts = collectConcepts(profiles, 5);
    }

    if (!concepts.length) {
      return NextResponse.json({ topic, anchors: [], note: "未发现可溯源的理论/事件概念" });
    }

    const { value: anchors, cached } = await withCache(
      `trace:${topic}:${llmEnabled() ? "llm" : "raw"}:${concepts.join(",")}`,
      24 * 60 * 60 * 1000,
      () => traceConcepts(concepts)
    );

    return NextResponse.json({ topic, llm: llmEnabled(), cached, anchors });
  } catch (e) {
    return NextResponse.json(
      { error: "INTERNAL", message: (e as Error).message },
      { status: 500 }
    );
  }
}
