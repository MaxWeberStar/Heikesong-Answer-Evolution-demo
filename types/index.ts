// types/index.ts — 数据模型（对齐《技术设计文档TDD.md》第 3 节）

/** 一条回答的原始记录（来自 zhihu-cli search zhihu / question answers） */
export interface RawAnswer {
  id: string;
  title: string;
  contentType: "Answer" | "Article" | string;
  authorName: string;
  authorBadge: string;
  contentText: string; // 摘要，非全文
  editTime: number; // Unix 秒
  voteUpCount: number;
  commentCount: number;
  url: string;
  rankingScore?: number;
}

/** 来源类型：固定四类兜底 + LLM 每话题动态补充（PRD 9.3） */
export type SourceType =
  | "生活经验型"
  | "理论溯源型"
  | "社会共识型"
  | "心理机制型"
  | string; // 动态专属标签

/** LLM 生成的答案画像（PRD 4.1.2） */
export interface AnswerProfile {
  id: string;
  claim: string; // 1 句核心主张
  sourceType: SourceType;
  school: string; // 派别 / 学科视角
  stance: string; // 立场
  keywords: string[];
  argumentStyle: "讲道理" | "举例" | "引用" | string;
  originEvent?: OriginRef; // 观点源头（理论/事件）
  postTime: string; // 由 editTime 转换
  votes: number;
  comments: number;
  author: string;
  authorBadge: string;
  url: string;
  questionCategory?: string; // 第一层：所属问题维度
}

/** 答案里指向的源头引用（未核实时 verified=false） */
export interface OriginRef {
  text: string;
  time?: string;
  verified: boolean;
  source?: string;
}

/** 溯源锚点（search global 核实后） */
export interface OriginAnchor {
  concept: string; // 如“世界的祛魅”
  proposer?: string; // 如 韦伯
  time?: string; // 如 ~1917
  summary: string; // 时地人事经过概要
  sources: { title: string; url: string }[];
  verified: boolean;
}

/** 问题维度（第一层分类，PRD 9.3） */
export interface QuestionCategory {
  name: string; // 如“概念理解 / 情感关系 / 职场金钱”
  description: string;
}

/** 谱系簇（P1） */
export interface Cluster {
  id: string;
  label: string;
  size: number;
  centroid2D: [number, number];
  axisHint: { x: string; y: string };
  members: string[]; // AnswerProfile.id
  timeDistribution: Record<string, number>; // "YYYY-MM" -> count
}

/** 一次话题分析结果（可缓存 / 入清单） */
export interface TopicAnalysis {
  topic: string;
  createdAt: string;
  categories: QuestionCategory[];
  answers: AnswerProfile[];
  anchors: OriginAnchor[];
  clusters?: Cluster[];
  stats: {
    total: number;
    collected?: number; // 累积取到的语料条数（验收：≥50）
    profiled?: number; // 实际画像条数（Top N）
    bySourceType: Record<string, number>;
    timeSpan?: { from: string; to: string };
  };
}

/** 取数模式 */
export type CollectMode = "search" | "question" | "hot";

/** /api/collect 返回 */
export interface CollectResult {
  topic: string;
  mode: CollectMode;
  answers: RawAnswer[];
  quotaWarning?: string;
  cached?: boolean;
}
