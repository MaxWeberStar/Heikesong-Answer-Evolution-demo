// app/api/collect/route.ts — 取数接口（PRD 4.1.1 / TDD 第 2 节）
// 支持三种 mode：search（关键词，赞数 top）、question（问题帖翻页）、hot（热榜）
import { NextRequest, NextResponse } from "next/server";
import {
  searchZhihu,
  searchZhihuMulti,
  questionAnswers,
  hotList,
  topByVotes,
  ZhihuError,
} from "@/lib/zhihu";
import { withCache } from "@/lib/cache";
import type { CollectMode, RawAnswer } from "@/types";

export const runtime = "nodejs"; // 需要 child_process，禁用 edge
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = (sp.get("mode") || "search") as CollectMode;
  const topic = sp.get("topic") || sp.get("query") || "";
  const topN = Number(sp.get("top") || 10);
  const multi = sp.get("multi") === "1"; // 多 query 累积（可选增强）

  try {
    if (mode === "hot") {
      // 热榜配额仅 100 → 缓存 15 分钟
      const { value, cached } = await withCache("hot:list", 15 * 60 * 1000, () => hotList(30));
      return NextResponse.json({ topic: "", mode, hot: value, cached });
    }

    if (mode === "question") {
      const url = sp.get("questionUrl") || "";
      if (!url) return bad("缺少 questionUrl");
      const expand = sp.get("expand") === "1";
      const query = (sp.get("query") || "").trim();
      // 问题回答配额仅 100 → 缓存 30 分钟；翻页取足再本地排序
      const { value, cached } = await withCache(
        `qa:${url}:${expand ? query : "single"}`,
        30 * 60 * 1000,
        async () => {
          const acc: RawAnswer[] = [];
          let offset = 0;
          for (let page = 0; page < 3; page++) {
            const r = await questionAnswers(url, offset, 50);
            acc.push(...r.answers);
            if (r.isEnd) break;
            offset = r.nextOffset;
          }
          if (!expand || !query) return { answers: acc, expanded: false, expansionMessage: "未提供问题标题，当前仅分析该问题帖。" };

          try {
            const candidates = await searchZhihuMulti([query, `如何看待${query}`]);
            const matched = candidates.filter((item) => isRelatedQuestionTitle(item.title, query));
            const seen = new Set(acc.map((item) => item.url || item.id));
            for (const item of matched) {
              const key = item.url || item.id;
              if (!seen.has(key)) {
                seen.add(key);
                acc.push(item);
              }
            }
            return {
              answers: acc,
              expanded: matched.length > 0,
              expansionMessage: matched.length > 0
                ? `已从标题线索找到 ${matched.length} 条相近问答，合并后分析。`
                : "未找到标题相似度足够高的其他问答，当前仅分析该问题帖。",
            };
          } catch {
            return { answers: acc, expanded: false, expansionMessage: "相近问答扩展失败，当前仅分析该问题帖。" };
          }
        }
      );
      const payload = Array.isArray(value) ? { answers: value, expanded: undefined, expansionMessage: undefined } : value;
      return NextResponse.json({
        topic,
        mode,
        answers: topByVotes(payload.answers, topN),
        expanded: payload.expanded,
        expansionMessage: payload.expansionMessage,
        cached,
      });
    }

    // mode === "search"
    if (!topic) return bad("缺少 topic / query");
    const { value, cached } = await withCache(
      `search:${topic}:${multi ? "multi" : "single"}`,
      60 * 60 * 1000,
      async () => {
        if (multi) {
          // 多 query 累积：主词 + 常见变体（可选增强，PRD 9.2）
          const queries = [
            topic,
            `${topic} 是什么`,
            `如何看待 ${topic}`,
            `${topic} 为什么`,
          ];
          return searchZhihuMulti(queries);
        }
        return searchZhihu(topic, 10);
      }
    );
    return NextResponse.json({
      topic,
      mode,
      answers: topByVotes(value, topN),
      cached,
    });
  } catch (e) {
    if (e instanceof ZhihuError) {
      const status = e.code === "AUTH_REQUIRED" ? 401 : 502;
      return NextResponse.json(
        { error: String(e.code), message: e.message },
        { status }
      );
    }
    return NextResponse.json(
      { error: "INTERNAL", message: (e as Error).message },
      { status: 500 }
    );
  }
}

function bad(msg: string) {
  return NextResponse.json({ error: "BAD_REQUEST", message: msg }, { status: 400 });
}

function isRelatedQuestionTitle(title: string, query: string): boolean {
  const left = normalizeTitle(title);
  const right = normalizeTitle(query);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  return longestCommonSubsequence(left, right) / Math.max(left.length, right.length) >= 0.8;
}

function normalizeTitle(value: string): string {
  return (value || "").toLowerCase().replace(/[\s，。！？、：；（）【】《》“”‘’"'!?.,:;()[\]<>]/g, "");
}

function longestCommonSubsequence(left: string, right: string): number {
  const row = new Array(right.length + 1).fill(0);
  for (const leftChar of left) {
    let diagonal = 0;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j];
      row[j] = leftChar === right[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = above;
    }
  }
  return row[right.length];
}
