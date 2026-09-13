// lib/trace.ts — 溯源核实（PRD 4.1.2 第三点 / TDD 4.2）
// 从画像的 originEvent 抽取概念 → search global 核实 → OriginAnchor[]
import { searchGlobal } from "@/lib/zhihu";
import { chat, parseJson, llmEnabled } from "@/lib/llm";
import type { AnswerProfile, OriginAnchor } from "@/types";

/** 收集画像里出现的源头概念（去重，取前 N 个高频/有意义的） */
export function collectConcepts(profiles: AnswerProfile[], max = 5): string[] {
  const counter = new Map<string, number>();
  for (const p of profiles) {
    const t = p.originEvent?.text?.trim();
    if (t && t.length > 1) counter.set(t, (counter.get(t) || 0) + 1);
    // 关键词里也可能含理论名
    for (const k of p.keywords || []) {
      if (/理论|效应|主义|定律|韦伯|弗洛伊德|马斯洛/.test(k))
        counter.set(k, (counter.get(k) || 0) + 1);
    }
  }
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

/** 对单个概念用 search global 找证据，再由 LLM 归纳时地人事经过 */
export async function traceConcept(concept: string): Promise<OriginAnchor> {
  let sources: { title: string; url: string; text: string }[] = [];
  try {
    sources = await searchGlobal(`${concept} 是什么 由谁提出 时间`, 6);
  } catch {
    sources = [];
  }

  const anchor: OriginAnchor = {
    concept,
    summary: "",
    sources: sources.map((s) => ({ title: s.title, url: s.url })),
    verified: false,
  };

  if (llmEnabled() && sources.length) {
    try {
      const out = await chat(
        `根据以下全网搜索结果，判断概念「${concept}」的来源。\n` +
          `资料：\n` +
          sources
            .map((s, i) => `[${i + 1}] ${s.title}\n${s.text.slice(0, 300)}`)
            .join("\n") +
          `\n只输出 JSON：{"proposer":"提出者(无则空)","time":"提出时间(无则空)","summary":"一句话概括时地人事经过","verified":true/false}\n` +
          `verified 仅当资料明确支持提出者与时间时为 true，否则 false。`,
        { json: true, maxTokens: 300 }
      );
      const j = parseJson<any>(out);
      if (j) {
        anchor.proposer = j.proposer || undefined;
        anchor.time = j.time || undefined;
        anchor.summary = j.summary || "";
        anchor.verified = Boolean(j.verified) && Boolean(j.time);
      }
    } catch {
      /* 保留未核实 */
    }
  } else if (sources.length) {
    anchor.summary = sources[0].text.slice(0, 120);
  }
  return anchor;
}

export async function traceConcepts(concepts: string[]): Promise<OriginAnchor[]> {
  const out: OriginAnchor[] = [];
  for (const c of concepts) out.push(await traceConcept(c));
  return out;
}
