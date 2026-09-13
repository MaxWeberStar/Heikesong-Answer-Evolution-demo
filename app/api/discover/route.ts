// app/api/discover/route.ts — 发现话题（热榜 TOP10 + 关键词）
import { NextRequest, NextResponse } from "next/server";
import { discoverHot } from "@/lib/discover";
import { withCache } from "@/lib/cache";
import { llmEnabled } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    // 热榜配额仅 100 → 缓存 15 分钟
    const { value, cached } = await withCache(
      `discover:hot:${llmEnabled() ? "kw" : "raw"}`,
      15 * 60 * 1000,
      () => discoverHot(10)
    );
    return NextResponse.json({ topics: value, cached, llm: llmEnabled() });
  } catch (e) {
    return NextResponse.json(
      { error: "DISCOVER_FAILED", message: (e as Error).message },
      { status: 502 }
    );
  }
}
