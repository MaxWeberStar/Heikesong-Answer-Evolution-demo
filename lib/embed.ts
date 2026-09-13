// lib/embed.ts — 文本向量化（OpenAI 兼容 embeddings API）
// PRD 9.6：走 API；无 EMBED_API_KEY 时由上层降级为 LLM 直接归类。
const BASE = process.env.EMBED_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1";
const KEY = process.env.EMBED_API_KEY || "";
const MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";

export const embedEnabled = () => Boolean(KEY);

/** 批量向量化；失败抛错由调用方降级 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!KEY) throw new Error("EMBED_DISABLED");
  if (!texts.length) return [];
  const res = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, input: texts.map((t) => (t || "").slice(0, 2000)) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`EMBED_HTTP_${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  const data = (j?.data || []) as { embedding: number[]; index: number }[];
  // 按 index 归位，确保顺序与输入一致
  const out: number[][] = new Array(texts.length);
  for (const d of data) out[d.index] = d.embedding;
  return out;
}
