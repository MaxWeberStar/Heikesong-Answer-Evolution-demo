// lib/zhihu-link.ts — 纯前后端通用的知乎链接工具（无 node 依赖，可在客户端 import）
// 从 lib/zhihu.ts 中抽离，避免客户端组件误打包 node:child_process。

/**
 * 规范化知乎问题 URL：CLI 只接受 zhihu.com/question/{id}，
 * 用户常复制带 /answer/xxx 或参数的链接 → 提取纯问题地址。
 */
export function normalizeQuestionUrl(raw: string): string {
  const s = (raw || "").trim();
  const m = s.match(/zhihu\.com\/question\/(\d+)/);
  if (m) return `https://www.zhihu.com/question/${m[1]}`;
  const idOnly = s.match(/^(\d{6,})$/);
  if (idOnly) return `https://www.zhihu.com/question/${idOnly[1]}`;
  return s; // 交给 CLI 校验并报错
}

/** 知乎链接类型识别结果 */
export type ZhihuLinkKind = "question" | "article" | "zvideo" | "topic" | "external" | "unknown";

export interface ZhihuLinkInfo {
  kind: ZhihuLinkKind;
  /** 当 kind==="question" 时给出规范化后的纯问题地址 */
  questionUrl?: string;
  /** 从链接中提取到的、可用于降级检索的标题/关键词线索（可空） */
  hint?: string;
}

/**
 * 识别一条知乎/外部链接的类型。
 * 目的：只有 question 帖才能走「读取问题回答」，其余（专栏/视频/话题/外链）
 * 需要在前端优雅降级为「按标题做关键词话题分析」，而不是把非法 URL 抛给 CLI 报错。
 */
export function classifyZhihuLink(raw: string): ZhihuLinkInfo {
  const s = (raw || "").trim();
  if (!s) return { kind: "unknown" };

  // 1) 问题帖：.../question/{id}（可带 /answer/xxx 或参数）
  const q = s.match(/zhihu\.com\/question\/(\d+)/);
  if (q) return { kind: "question", questionUrl: `https://www.zhihu.com/question/${q[1]}` };

  // 纯数字 id 也按问题处理
  const idOnly = s.match(/^(\d{6,})$/);
  if (idOnly) return { kind: "question", questionUrl: `https://www.zhihu.com/question/${idOnly[1]}` };

  // 2) 专栏文章
  if (/zhuanlan\.zhihu\.com\/p\/\d+/.test(s)) return { kind: "article" };
  // 3) 视频
  if (/zhihu\.com\/zvideo\/\d+/.test(s)) return { kind: "zvideo" };
  // 4) 话题页 / 圆桌
  if (/zhihu\.com\/(topic|roundtable)\/\d+/.test(s)) return { kind: "topic" };

  // 5) 非知乎外链
  if (!/zhihu\.com/i.test(s)) return { kind: "external" };

  return { kind: "unknown" };
}

/** 从问题 URL 提取问题 id（用于生成唯一缓存标识；无则返回空串） */
export function questionIdOf(url: string): string {
  const m = (url || "").match(/question\/(\d+)/);
  return m ? m[1] : "";
}

/**
 * 从回答 URL 里的 answer id 反推发布时间（Unix 秒）。
 * 知乎 answer id 为雪花 ID，高位含毫秒时间戳，epoch≈1292780000000（实测校准，19-20 位新格式误差<1天）。
 * 用于「问题帖入口」——该接口不返回 EditTime，但 URL 含 answer id，可据此还原时间做时间轴。
 * 无法可靠还原（旧短 id / 推算年份越界）时返回 0，由上层标注"时间未知"。
 */
const ZHIHU_SNOWFLAKE_EPOCH_MS = 1292780000000;
export function answerTimeFromUrl(url: string): number {
  const m = (url || "").match(/answer\/(\d+)/);
  if (!m) return 0;
  const raw = m[1];
  // 用 BigInt 精确计算，避免大整数（>2^53）经 Number 丢精度
  let sec: number;
  try {
    const aid = BigInt(raw);
    // 仅对新格式雪花 ID（约 ≥ 1e17）反推；旧短 id 不可靠
    if (aid < 100000000000000000n) return 0;
    const ms = aid / (1n << 22n) + BigInt(ZHIHU_SNOWFLAKE_EPOCH_MS);
    sec = Number(ms / 1000n);
  } catch {
    return 0;
  }
  // 合理性校验：2015-01-01 ~ 现在+1天，否则判为不可靠
  const min = 1420041600; // 2015-01-01
  const max = Math.floor(Date.now() / 1000) + 86400;
  if (sec < min || sec > max) return 0;
  return sec;
}
