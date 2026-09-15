// lib/zhihu-http.ts — 知乎开放平台 HTTP API 封装（云端无 CLI 时使用）
// 依据 skill: http-api.md。Bearer <Access Secret> + X-Request-Timestamp（秒级）。
// 返回结构对齐 lib/zhihu.ts 的 CLI 版，便于上层无感切换。
import type { RawAnswer } from "@/types";
import { answerTimeFromUrl } from "@/lib/zhihu-link";

const BASE = process.env.ZHIHU_API_BASE || "https://developer.zhihu.com/api/v1";
const SECRET = process.env.ZHIHU_ACCESS_SECRET || "";

export const httpEnabled = () => Boolean(SECRET);

function headers() {
  return {
    Authorization: `Bearer ${SECRET}`,
    "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
    "Content-Type": "application/json",
  };
}

async function getJson(path: string, params: Record<string, string | number>): Promise<any> {
  const u = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u.toString(), { headers: headers() });
  const text = await res.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`ZHIHU_HTTP_BAD_JSON: ${text.slice(0, 160)}`); }
  if (j.Code !== undefined && j.Code !== 0) {
    throw new Error(`ZHIHU_HTTP_${j.Code}: ${j.Message || "api error"}`);
  }
  return j.Data ?? j;
}

/** 归一为 RawAnswer（字段名与 CLI 版一致） */
function toRaw(it: any): RawAnswer {
  const url = it.Url ?? "";
  const apiEditTime = Number(it.EditTime ?? 0);
  const inferredEditTime = answerTimeFromUrl(url);
  // 问题帖回答无 EditTime → 用 answer id（雪花ID）反推时间，但 UI 必须标为未核实。
  const editTime = apiEditTime || inferredEditTime;
  return {
    id: String(it.ContentID ?? it.ContentToken ?? it.Url ?? Math.random()),
    title: it.Title ?? "",
    contentType: it.ContentType ?? "Answer",
    authorName: it.AuthorName ?? "",
    authorBadge: it.AuthorBadgeText ?? "",
    contentText: it.ContentText ?? it.Summary ?? "",
    editTime,
    editTimeSource: apiEditTime ? "api" : inferredEditTime ? "answer_id" : "unknown",
    voteUpCount: it.VoteUpCount == null ? -1 : Number(it.VoteUpCount),
    commentCount: it.CommentCount == null ? -1 : Number(it.CommentCount),
    url,
    rankingScore: it.RankingScore,
  };
}

export async function searchZhihuHttp(query: string, count = 10): Promise<RawAnswer[]> {
  const data = await getJson("/content/zhihu_search", { Query: query, Count: Math.min(Math.max(count, 1), 10) });
  return (data?.Items ?? []).map(toRaw);
}

export async function searchGlobalHttp(
  query: string,
  count = 10,
  searchDb: "all" | "realtime" | "static" = "all"
): Promise<{ title: string; url: string; text: string }[]> {
  const data = await getJson("/content/global_search", {
    Query: query,
    Count: Math.min(Math.max(count, 1), 20),
    SearchDB: searchDb,
  });
  return (data?.Items ?? []).map((it: any) => ({
    title: it.Title ?? "",
    url: it.Url ?? "",
    text: it.ContentText ?? it.Summary ?? "",
  }));
}

export async function hotListHttp(
  limit = 30
): Promise<{ title: string; url?: string; summary?: string; thumbnail?: string }[]> {
  const data = await getJson("/content/hot_list", { Limit: Math.min(Math.max(limit, 1), 30) });
  const items = data?.Items ?? [];
  return (Array.isArray(items) ? items : []).map((it: any) => ({
    title: it.Title ?? "",
    url: it.Url,
    summary: it.Summary ?? "",
    thumbnail: it.ThumbnailUrl ?? "",
  }));
}

export async function questionAnswersHttp(
  questionUrl: string,
  offset = 0,
  limit = 50
): Promise<{ answers: RawAnswer[]; isEnd: boolean; nextOffset: number }> {
  const data = await getJson("/content/question_answers", {
    QuestionUrl: questionUrl,
    Offset: offset,
    Limit: Math.min(Math.max(limit, 1), 50),
  });
  const items = data?.Items ?? [];
  const paging = data?.Paging ?? {};
  return {
    answers: items.map(toRaw),
    isEnd: Boolean(paging.IsEnd ?? true),
    nextOffset: Number(paging.NextOffset ?? offset + limit),
  };
}

export async function questionRecommendHttp(query: string, count = 10): Promise<any[]> {
  const data = await getJson("/user/question_recommendations", {
    Query: query,
    Count: Math.min(Math.max(count, 1), 20),
  });
  return data?.Items ?? [];
}
