// app/api/recommend/route.ts — P2 更多发现：基于当前话题推荐相关知乎问题
import { NextRequest, NextResponse } from "next/server";
import { questionRecommend } from "@/lib/zhihu";
import { withCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/recommend?topic=xxx&count=6
export async function GET(req: NextRequest) {
  const topic = req.nextUrl.searchParams.get("topic") || "";
  const count = Math.min(Math.max(Number(req.nextUrl.searchParams.get("count") || 6), 1), 12);
  if (!topic) return NextResponse.json({ error: "BAD_REQUEST", message: "缺少 topic" }, { status: 400 });
  try {
    const { value, cached } = await withCache(`recommend:${topic}:${count}`, 30 * 60 * 1000, async () => {
      const items = await questionRecommend(topic, count);
      return (Array.isArray(items) ? items : []).map((it: any) => ({
        title: it.Title ?? it.title ?? "",
        url: it.Url ?? it.url ?? "",
      })).filter((x: any) => x.title && x.url);
    });
    return NextResponse.json({ topic, cached, items: value });
  } catch (e) {
    return NextResponse.json({ error: "RECOMMEND_FAILED", message: (e as Error).message }, { status: 502 });
  }
}
