// lib/llm.ts — LLM 客户端（OpenAI 兼容；无 key 时降级为规则版，保证零成本可演示）
// 大赛 openainext 资源即 OpenAI 兼容，填 .env.local 的 LLM_* 即可。

const BASE = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
const KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";

export const llmEnabled = () => Boolean(KEY);

interface ChatOpts {
  system?: string;
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
}

/** 调用 chat completions；失败抛错由调用方降级 */
export async function chat(prompt: string, opts: ChatOpts = {}): Promise<string> {
  if (!KEY) throw new Error("LLM_DISABLED");
  const body: any = {
    model: MODEL,
    messages: [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: prompt },
    ],
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 800,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM_HTTP_${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

/** 尝试从模型输出里解析 JSON（容错去除 ```json 包裹） */
export function parseJson<T = any>(text: string): T | null {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
