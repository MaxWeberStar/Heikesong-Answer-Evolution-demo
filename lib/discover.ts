// lib/discover.ts — 发现话题：热榜 TOP10 + 每条抽 3-5 关键词
import { hotList } from "@/lib/zhihu";
import { chat, parseJson, llmEnabled } from "@/lib/llm";

export interface HotTopic {
  rank: number;
  title: string;
  url?: string;
  keywords: string[];
  category?: string; // 新闻时事分类（社会/科技/职场/情感/财经/教育/其他）
}

const CATEGORIES = ["社会", "科技", "职场", "情感", "财经", "教育", "娱乐", "其他"];

/** 取热榜 top N，并为每条抽关键词 + 时事分类（批量一次 LLM） */
export async function discoverHot(limit = 10): Promise<HotTopic[]> {
  const items = (await hotList(30)).slice(0, limit);
  if (!items.length) return [];

  let kwMap: Record<string, string[]> = {};
  let catMap: Record<string, string> = {};
  if (llmEnabled()) {
    try {
      const out = await chat(
        `为下列知乎热榜问题各抽取 3-5 个可用于检索的核心关键词（名词短语，不要整句），并归类到时事类别之一：${CATEGORIES.join(
          "/"
        )}。\n` +
          items.map((it, i) => `${i + 1}. ${it.title}`).join("\n") +
          `\n只输出 JSON：{"items":[{"i":1,"keywords":["...","..."],"category":"社会"}]}`,
        { json: true, maxTokens: 800 }
      );
      const j = parseJson<{ items: { i: number; keywords: string[]; category: string }[] }>(out);
      for (const x of j?.items || []) {
        kwMap[String(x.i)] = x.keywords || [];
        catMap[String(x.i)] = x.category || "其他";
      }
    } catch {
      /* 降级 */
    }
  }

  return items.map((it, i) => ({
    rank: i + 1,
    title: it.title,
    url: it.url,
    keywords: kwMap[String(i + 1)] || fallbackKeywords(it.title),
    category: catMap[String(i + 1)] || "其他",
  }));
}

/** 规则版关键词：取标题里较长的中文片段 */
function fallbackKeywords(title: string): string[] {
  const parts = title
    .replace(/[，。？！、；：""''《》（）\s]+/g, " ")
    .split(" ")
    .filter((s) => s.length >= 2);
  return parts.slice(0, 4);
}
