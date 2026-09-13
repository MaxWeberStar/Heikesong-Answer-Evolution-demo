// lib/zhihu.ts — 知乎 CLI 封装（服务端专用；Access Secret 只留服务端）
// 命令与配额均对齐实测 `zhihu-cli capabilities`（见 TDD 第 2 节）
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RawAnswer } from "@/types";
import { normalizeQuestionUrl, classifyZhihuLink, answerTimeFromUrl } from "@/lib/zhihu-link";

// 兼容旧引用：从纯工具文件 re-export（不含 node 依赖）
export { normalizeQuestionUrl, classifyZhihuLink };
export type { ZhihuLinkKind, ZhihuLinkInfo } from "@/lib/zhihu-link";

const execFileAsync = promisify(execFile);

const CLI =
  process.env.ZHIHU_CLI ||
  "/Applications/看山工作台.app/Contents/Resources/cli-bundle/zhihu/current/zhihu-cli";

export class ZhihuError extends Error {
  constructor(public code: number | string, message: string) {
    super(message);
    this.name = "ZhihuError";
  }
}

// —— 轻量全局限流：串行化 CLI 调用 + 最小间隔，避免触发知乎 QPS 限制 ——
let chain: Promise<void> = Promise.resolve();
let lastCall = 0;
const MIN_GAP_MS = 900; // 两次 CLI 调用最小间隔

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(): Promise<void> {
  const prev = chain;
  let release!: () => void;
  chain = new Promise<void>((r) => (release = r));
  await prev;
  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  // 调用方结束后需 release：用 microtask 在 callCli 内释放
  (throttle as any)._release = release;
}

function isRateLimit(msg: string): boolean {
  return /rate limit|frequency|too many|429|限流|频率/i.test(msg);
}

/** 统一调用 CLI 并解析 JSON（串行 + 限流 + 429 退避重试）。 */
async function callCli(args: string[], timeout = "30s"): Promise<any> {
  await throttle();
  const release = (throttle as any)._release as () => void;
  try {
    let attempt = 0;
    while (true) {
      let stdout = "";
      try {
        const res = await execFileAsync(CLI, [...args, "--timeout", timeout], {
          maxBuffer: 20 * 1024 * 1024,
        });
        stdout = res.stdout;
      } catch (e: any) {
        stdout = e?.stdout || "";
        if (!stdout) throw new ZhihuError("CLI_EXEC_FAILED", e?.message || "cli failed");
      }
      let json: any;
      try {
        json = JSON.parse(stdout);
      } catch {
        throw new ZhihuError("BAD_JSON", "无法解析 CLI 输出");
      }
      if (json.Code !== undefined && json.Code !== 0) {
        const msg = json.Message || "zhihu api error";
        // 频率限制：退避后重试，最多 2 次
        if (isRateLimit(msg) && attempt < 2) {
          attempt++;
          await sleep(1200 * attempt);
          continue;
        }
        throw new ZhihuError(json.Code, msg);
      }
      return json.Data ?? json;
    }
  } finally {
    release();
  }
}

/** 把 CLI 返回的一条 Item 归一为 RawAnswer */
function toRawAnswer(it: any): RawAnswer {
  const url = it.Url ?? "";
  // 问题帖入口的回答无 EditTime，但 URL 含 answer id（雪花ID）可反推发布时间 → 使时间轴可用
  const editTime = Number(it.EditTime ?? 0) || answerTimeFromUrl(url);
  return {
    id: String(it.ContentID ?? it.ContentToken ?? it.Url ?? Math.random()),
    title: it.Title ?? "",
    contentType: it.ContentType ?? "Answer",
    authorName: it.AuthorName ?? "",
    authorBadge: it.AuthorBadgeText ?? "",
    contentText: it.ContentText ?? it.Summary ?? "",
    editTime,
    voteUpCount: Number(it.VoteUpCount ?? 0),
    commentCount: Number(it.CommentCount ?? 0),
    url,
    rankingScore: it.RankingScore,
  };
}

/** 搜索知乎（单次 ≤10） */
export async function searchZhihu(query: string, count = 10): Promise<RawAnswer[]> {
  const data = await callCli([
    "search",
    "zhihu",
    "--query",
    query,
    "--count",
    String(Math.min(Math.max(count, 1), 10)),
  ]);
  const items = data?.Items ?? [];
  return items.map(toRawAnswer);
}

/** 多 query 累积 + 按 Url 去重（PRD 9.2 可选增强） */
export async function searchZhihuMulti(queries: string[]): Promise<RawAnswer[]> {
  const seen = new Set<string>();
  const out: RawAnswer[] = [];
  for (const q of queries) {
    let items: RawAnswer[] = [];
    try {
      items = await searchZhihu(q, 10);
    } catch (e) {
      // 单个 query 失败不阻塞整体
      continue;
    }
    for (const it of items) {
      const key = it.url || it.id;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(it);
      }
    }
  }
  return out;
}

/** 全网搜索（溯源用，单次 ≤20） */
export async function searchGlobal(
  query: string,
  count = 10,
  searchDb: "all" | "realtime" | "static" = "all"
): Promise<{ title: string; url: string; text: string }[]> {
  const data = await callCli([
    "search",
    "global",
    "--query",
    query,
    "--count",
    String(Math.min(Math.max(count, 1), 20)),
    "--search-db",
    searchDb,
  ]);
  const items = data?.Items ?? data?.WebResults ?? [];
  return items.map((it: any) => ({
    title: it.Title ?? "",
    url: it.Url ?? "",
    text: it.ContentText ?? it.Summary ?? it.Snippet ?? "",
  }));
}

/** 某问题帖下的回答列表（单页 ≤50，可翻页；配额 100，须缓存） */
export async function questionAnswers(
  questionUrl: string,
  offset = 0,
  limit = 50
): Promise<{ answers: RawAnswer[]; isEnd: boolean; nextOffset: number }> {
  const data = await callCli([
    "question",
    "answers",
    "--question-url",
    normalizeQuestionUrl(questionUrl),
    "--offset",
    String(offset),
    "--limit",
    String(Math.min(Math.max(limit, 1), 50)),
  ]);
  const items = data?.Items ?? data?.Answers ?? [];
  const paging = data?.Paging ?? {};
  return {
    answers: items.map(toRawAnswer),
    isEnd: Boolean(paging.IsEnd ?? true),
    nextOffset: Number(paging.NextOffset ?? offset + limit),
  };
}

/** 热榜（≤30，配额仅 100，须缓存） */
export async function hotList(
  limit = 30
): Promise<{ title: string; url?: string; summary?: string; thumbnail?: string }[]> {
  const data = await callCli(["hot", "--limit", String(Math.min(Math.max(limit, 1), 30))]);
  const items = data?.Items ?? data ?? [];
  return (Array.isArray(items) ? items : []).map((it: any) => ({
    title: it.Title ?? it.Query ?? "",
    url: it.Url,
    summary: it.Summary ?? "",
    thumbnail: it.ThumbnailUrl ?? "",
  }));
}

/** 待答问题推荐（“更多发现”） */
export async function questionRecommend(query: string, count = 10) {
  const data = await callCli([
    "question",
    "recommend",
    "--query",
    query,
    "--count",
    String(Math.min(Math.max(count, 1), 20)),
  ]);
  return data?.Items ?? data ?? [];
}

/** 额度自检 */
export async function quota(): Promise<Record<string, any>[]> {
  const data = await callCli(["quota"]);
  return Array.isArray(data) ? data : [];
}

/** 按赞数降序取 Top N（接口不直接给 top10） */
export function topByVotes(answers: RawAnswer[], n = 10): RawAnswer[] {
  return [...answers].sort((a, b) => b.voteUpCount - a.voteUpCount).slice(0, n);
}


