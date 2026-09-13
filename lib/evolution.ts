// lib/evolution.ts — 真实版演进卡片：把 Top10 回答归类为共识/分歧/盲区 + 演进角色
// 全部基于真实回答，可溯源；不编造历史数据。
import { chat, parseJson, llmEnabled } from "@/lib/llm";
import type { AnswerProfile } from "@/types";

export type EvoRole = "初始" | "补充" | "质疑" | "新维度";

export interface EvoNode {
  id: string;
  period: string; // 真实发布时间（YYYY-MM）
  role: EvoRole;
  actor: string; // 作者 + 身份
  claim: string;
  votes: number;
  comments: number;
  url: string;
  relation?: string; // 与前序观点的关系说明（回应了谁/如何回应）
}

export interface Synthesis {
  consensus: string[]; // 共识
  divergence: string[]; // 分歧
  blindspot: string[]; // 盲区
}

export interface EvolutionResult {
  topic: string;
  nodes: EvoNode[]; // 按时间排序
  synthesis: Synthesis;
  llm: boolean;
}

/** 基于已生成的答案画像做演进分析 */
export async function analyzeEvolution(
  topic: string,
  profiles: AnswerProfile[]
): Promise<EvolutionResult> {
  // 有发布时间的按时间排序；问题帖入口的回答无 postTime → 保留原始顺序（不因缺时间丢弃）
  const hasTime = profiles.some((p) => p.postTime);
  const sorted = hasTime
    ? [...profiles].filter((p) => p.postTime).sort((a, b) => (a.postTime > b.postTime ? 1 : -1))
    : [...profiles];

  // 默认角色（无 LLM 时按时间/立场粗分）
  const nodes: EvoNode[] = sorted.map((p, i) => ({
    id: p.id,
    period: p.postTime ? p.postTime.slice(0, 7) : `#${i + 1}`, // 无时间时用序号占位
    role: ruleRole(p, i, sorted.length),
    actor: (p.author || "匿名") + (p.authorBadge ? `（${p.authorBadge}）` : ""),
    claim: p.claim,
    votes: p.votes,
    comments: p.comments,
    url: p.url,
  }));

  let synthesis: Synthesis = { consensus: [], divergence: [], blindspot: [] };

  if (llmEnabled() && sorted.length) {
    try {
      const out = await chat(
        `以下是知乎话题「${topic}」下的真实回答（id/时间/作者/主张）。` +
          (hasTime ? "已按时间排序。" : "这批回答来自问题帖，无发布时间字段，按抓取顺序排列。") +
          `\n` +
          sorted
            .map(
              (p, i) =>
                `[${p.id}] ${p.postTime || `第${i + 1}条`} ${p.author || "匿名"}: ${p.claim}（${p.stance || ""}）`
            )
            .join("\n") +
          `\n请完成两件事：\n` +
          `1) 为每条标注演进角色：初始/补充/质疑/新维度（初始=最基础界定，补充=延展同一方向，质疑=反对/修正/指出局限，新维度=引入全新视角或跨领域参照）。\n` +
          `请尽量体现观点的张力：只要有回答表达了保留、反对、"但是"、指出前面观点的问题，就标为"质疑"；只要引入了新的学科视角、比喻或此前没提过的维度，就标为"新维度"。不要把所有回答都标成初始或补充。\n` +
          `2) 归纳这些回答的：共识(大家一致的)、分歧(互相冲突的)、盲区(几乎无人讨论但重要的)。\n` +
          `3) 为每条（第一条除外）用一句话说明它与前面观点的关系（回应/补充/反驳了什么），字段名 relation。\n` +
          `只输出 JSON：{"roles":[{"id":"...","role":"初始|补充|质疑|新维度","relation":"一句话关系说明"}],"consensus":["..."],"divergence":["..."],"blindspot":["..."]}`,
        { json: true, maxTokens: 900 }
      );
      const j = parseJson<any>(out);
      if (j) {
        const infoMap = new Map(
          (j.roles || []).map((r: any) => [String(r.id), r])
        );
        for (const n of nodes) {
          const info: any = infoMap.get(n.id);
          if (info) {
            if (info.role) n.role = info.role as EvoRole;
            if (info.relation) n.relation = info.relation;
          }
        }
        synthesis = {
          consensus: j.consensus || [],
          divergence: j.divergence || [],
          blindspot: j.blindspot || [],
        };
      }
    } catch {
      /* 保留规则版 */
    }
  }

  return { topic, nodes, synthesis, llm: llmEnabled() };
}

function ruleRole(p: AnswerProfile, i: number, total: number): EvoRole {
  if (i === 0) return "初始";
  if (/质疑|反对|不是|误|但/.test(p.claim)) return "质疑";
  if (p.sourceType === "理论溯源型") return "新维度";
  return "补充";
}
