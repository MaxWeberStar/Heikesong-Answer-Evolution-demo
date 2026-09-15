// lib/cluster.ts — P1 观点谱系仪聚类流水线（PRD 4.2 / TDD 5）
// 主路径：embedding → kmeans(K自适应) → PCA 降 2D → LLM 命名簇与两轴
// 降级：无 embedding key → LLM 直接把回答归类为簇并给 2D 坐标
import { kmeans } from "ml-kmeans";
import { Matrix } from "ml-matrix";
import { embed, embedEnabled } from "@/lib/embed";
import { chat, parseJson, llmEnabled } from "@/lib/llm";
import type { AnswerProfile, Cluster } from "@/types";

export interface GenealogyResult {
  clusters: Cluster[];
  axisHint: { x: string; y: string }; // 两条主轴命名
  points: { id: string; x: number; y: number; cluster: string; sourceTitle: string; claim: string; period: string; postTimeSource: AnswerProfile["postTimeSource"]; votes: number; url: string; sourceType: string }[];
  mode: "embedding" | "llm" | "rule";
}

/** 主入口：对话题回答做谱系分析 */
export async function analyzeGenealogy(
  topic: string,
  profiles: AnswerProfile[]
): Promise<GenealogyResult> {
  const items = profiles.filter((p) => p.claim);
  if (items.length < 3) {
    // 数据太少无法聚类 → 单簇兜底
    return singleClusterFallback(items);
  }

  // 主路径：embedding + kmeans + PCA
  if (embedEnabled()) {
    try {
      return await embeddingPipeline(topic, items);
    } catch {
      /* 降级 LLM */
    }
  }
  // 降级：LLM 直接归类
  if (llmEnabled()) {
    try {
      return await llmPipeline(topic, items);
    } catch {
      /* 降级规则 */
    }
  }
  return ruleFallback(items);
}

/** K 自适应：3-5，随样本量增长 */
function pickK(n: number): number {
  if (n < 6) return 3;
  if (n < 12) return 4;
  return 5;
}

/** embedding → kmeans → PCA 2D */
async function embeddingPipeline(topic: string, items: AnswerProfile[]): Promise<GenealogyResult> {
  const vectors = await embed(items.map((p) => `${p.claim}。${(p.keywords || []).join(" ")}`));
  if (vectors.some((v) => !v || !v.length)) throw new Error("EMBED_INCOMPLETE");

  const K = Math.min(pickK(items.length), items.length);
  const km = kmeans(vectors, K, { seed: 42, initialization: "kmeans++" });

  // PCA 降 2D：对向量矩阵做中心化 + SVD 取前两主成分
  const coords2d = pca2d(vectors);

  // 组装每个点
  const points = items.map((p, i) => ({
    id: p.id,
    x: round(coords2d[i][0]),
    y: round(coords2d[i][1]),
    cluster: `c${km.clusters[i]}`,
    sourceTitle: p.sourceTitle,
    claim: p.claim,
    period: p.postTime ? p.postTime.slice(0, 7) : "",
    postTimeSource: p.postTimeSource,
    votes: p.votes,
    url: p.url,
    sourceType: p.sourceType,
  }));

  // 按簇聚合
  const clusters = buildClusters(items, km.clusters, coords2d);
  // LLM 命名簇与两轴
  const named = await nameClustersAndAxes(topic, items, km.clusters, clusters);
  return { clusters: named.clusters, axisHint: named.axisHint, points, mode: "embedding" };
}

/** PCA 降 2D（中心化后 SVD 取前 2 主成分投影） */
function pca2d(vectors: number[][]): number[][] {
  const M = new Matrix(vectors);
  // 中心化
  const mean = M.mean("column");
  const centered = M.clone();
  for (let c = 0; c < centered.columns; c++) {
    for (let r = 0; r < centered.rows; r++) {
      centered.set(r, c, centered.get(r, c) - mean[c]);
    }
  }
  // SVD：U * S * V^T，取 U 的前两列 * 对应奇异值作为 2D 坐标
  // ml-matrix 的 SVD
  const { SingularValueDecomposition } = require("ml-matrix");
  const svd = new SingularValueDecomposition(centered, { autoTranspose: true });
  const U = svd.leftSingularVectors; // rows x rows
  const s = svd.diagonal;
  const out: number[][] = [];
  for (let r = 0; r < centered.rows; r++) {
    out.push([U.get(r, 0) * (s[0] || 1), U.get(r, 1) * (s[1] || 1)]);
  }
  return normalize2d(out);
}

/** 把 2D 坐标归一化到 [-1,1] 便于前端渲染 */
function normalize2d(pts: number[][]): number[][] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const nx = mkNorm(xs), ny = mkNorm(ys);
  return pts.map((p) => [nx(p[0]), ny(p[1])]);
}
function mkNorm(arr: number[]) {
  const lo = Math.min(...arr), hi = Math.max(...arr);
  const span = hi - lo || 1;
  return (v: number) => ((v - lo) / span) * 2 - 1;
}
function round(v: number) {
  return Math.round(v * 1000) / 1000;
}

/** 按 kmeans 分配结果聚合成 Cluster[]（未命名，label 待 LLM 填） */
function buildClusters(
  items: AnswerProfile[],
  assign: number[],
  coords2d: number[][]
): Cluster[] {
  const groups = new Map<number, number[]>(); // clusterIdx -> item indices
  assign.forEach((c, i) => {
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(i);
  });
  const clusters: Cluster[] = [];
  for (const [c, idxs] of groups) {
    // 质心
    const cx = idxs.reduce((s, i) => s + coords2d[i][0], 0) / idxs.length;
    const cy = idxs.reduce((s, i) => s + coords2d[i][1], 0) / idxs.length;
    // 时间分布
    const timeDist: Record<string, number> = {};
    for (const i of idxs) {
      const ym = items[i].postTime ? items[i].postTime.slice(0, 7) : "未知";
      timeDist[ym] = (timeDist[ym] || 0) + 1;
    }
    clusters.push({
      id: `c${c}`,
      label: `观点簇 ${c + 1}`, // 占位，待 LLM 命名
      size: idxs.length,
      centroid2D: [round(cx), round(cy)],
      axisHint: { x: "", y: "" },
      members: idxs.map((i) => items[i].id),
      timeDistribution: timeDist,
    });
  }
  return clusters.sort((a, b) => b.size - a.size);
}

/** LLM 为每个簇命名 + 命名两条主轴 */
async function nameClustersAndAxes(
  topic: string,
  items: AnswerProfile[],
  assign: number[],
  clusters: Cluster[]
): Promise<{ clusters: Cluster[]; axisHint: { x: string; y: string } }> {
  if (!llmEnabled()) return { clusters, axisHint: { x: "经验 ↔ 理论", y: "正向 ↔ 批判" } };
  // 每簇取代表性主张（前 3 条）
  const byId = new Map(items.map((p) => [p.id, p]));
  const brief = clusters
    .map((cl) => {
      const claims = cl.members.slice(0, 3).map((id) => byId.get(id)?.claim).filter(Boolean);
      return `簇${cl.id}（${cl.size}条）: ${claims.join(" / ")}`;
    })
    .join("\n");
  try {
    const out = await chat(
      `话题「${topic}」下的回答被聚成若干观点簇，如下：\n${brief}\n\n` +
        `请完成两件事：\n` +
        `1) 为每个簇起一个 4-10 字的观点标签（概括该簇的共同立场/视角）。\n` +
        `2) 命名这批观点的两条对立主轴（用于 2D 散点的 x/y 轴，如"经验↔理论""正向↔批判""个体↔社会"），选最能区分这些簇的两组。\n` +
        `只输出 JSON：{"clusters":[{"id":"c0","label":"..."}],"axisX":"经验 ↔ 理论","axisY":"正向 ↔ 批判"}`,
      { json: true, maxTokens: 500 }
    );
    const j = parseJson<{ clusters: { id: string; label: string }[]; axisX: string; axisY: string }>(out);
    if (j) {
      const labelMap = new Map((j.clusters || []).map((c) => [c.id, c.label]));
      const axisHint = { x: j.axisX || "经验 ↔ 理论", y: j.axisY || "正向 ↔ 批判" };
      const named = clusters.map((cl) => ({
        ...cl,
        label: labelMap.get(cl.id) || cl.label,
        axisHint,
      }));
      return { clusters: named, axisHint };
    }
  } catch {
    /* 保留占位标签 */
  }
  return { clusters, axisHint: { x: "经验 ↔ 理论", y: "正向 ↔ 批判" } };
}

/** 降级：无 embedding，用 LLM 直接把回答归类为 3-5 簇并给 2D 坐标 */
async function llmPipeline(topic: string, items: AnswerProfile[]): Promise<GenealogyResult> {
  const list = items
    .map((p, i) => `[${i}] ${p.claim}（${p.stance || ""}｜${p.sourceType}）`)
    .join("\n");
  const out = await chat(
    `话题「${topic}」下有 ${items.length} 条回答（见下）。请把它们聚成 3-5 个观点簇。\n${list}\n\n` +
      `要求：\n` +
      `1) 命名两条最能区分这些观点的对立主轴（x/y），如"经验↔理论""正向↔批判"。\n` +
      `2) 为每条回答给出它在 [-1,1]×[-1,1] 坐标系里的 x,y（沿两轴的倾向），并指派 clusterId(0..K-1)。\n` +
      `3) 为每个簇起 4-10 字标签。\n` +
      `只输出 JSON：{"axisX":"...","axisY":"...","clusters":[{"id":0,"label":"..."}],"points":[{"i":0,"x":0.3,"y":-0.5,"cluster":0}]}`,
    { json: true, maxTokens: 1500 }
  );
  const j = parseJson<any>(out);
  if (!j?.points?.length) throw new Error("LLM_CLUSTER_EMPTY");

  const axisHint = { x: j.axisX || "经验 ↔ 理论", y: j.axisY || "正向 ↔ 批判" };
  const clusterLabel = new Map<string, string>((j.clusters || []).map((c: any) => [`c${c.id}`, c.label]));
  const assignByI = new Map<number, number>((j.points || []).map((p: any) => [Number(p.i), Number(p.cluster ?? 0)]));

  const points = items.map((p, i) => {
    const jp = (j.points || []).find((x: any) => Number(x.i) === i) || {};
    const cl = Number(jp.cluster ?? 0);
    return {
      id: p.id,
      x: round(clamp(Number(jp.x ?? 0))),
      y: round(clamp(Number(jp.y ?? 0))),
      cluster: `c${cl}`,
      sourceTitle: p.sourceTitle,
      claim: p.claim,
      period: p.postTime ? p.postTime.slice(0, 7) : "",
      postTimeSource: p.postTimeSource,
      votes: p.votes,
      url: p.url,
      sourceType: p.sourceType,
    };
  });

  // 聚合 clusters
  const assign = items.map((_, i) => assignByI.get(i) ?? 0);
  const coords2d = points.map((p) => [p.x, p.y]);
  const clusters = buildClusters(items, assign, coords2d).map((cl) => ({
    ...cl,
    label: clusterLabel.get(cl.id) || cl.label,
    axisHint,
  }));
  return { clusters, axisHint, points, mode: "llm" };
}
function clamp(v: number) {
  return Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** 规则兜底（无 LLM 无 embedding）：按 sourceType 分簇，坐标按类型散布 */
function ruleFallback(items: AnswerProfile[]): GenealogyResult {
  const typeAngle: Record<string, number> = {};
  const types = Array.from(new Set(items.map((p) => p.sourceType)));
  types.forEach((t, i) => (typeAngle[t] = (i / Math.max(types.length, 1)) * Math.PI * 2));
  const idxOfType = new Map(types.map((t, i) => [t, i]));
  const points = items.map((p, i) => {
    const ang = typeAngle[p.sourceType] ?? 0;
    const jitter = (i % 5) * 0.06;
    return {
      id: p.id,
      x: round(Math.cos(ang) * (0.6 + jitter)),
      y: round(Math.sin(ang) * (0.6 + jitter)),
      cluster: `c${idxOfType.get(p.sourceType) ?? 0}`,
      sourceTitle: p.sourceTitle,
      claim: p.claim,
      period: p.postTime ? p.postTime.slice(0, 7) : "",
      postTimeSource: p.postTimeSource,
      votes: p.votes,
      url: p.url,
      sourceType: p.sourceType,
    };
  });
  const assign = items.map((p) => idxOfType.get(p.sourceType) ?? 0);
  const coords2d = points.map((p) => [p.x, p.y]);
  const clusters = buildClusters(items, assign, coords2d).map((cl, i) => ({
    ...cl,
    label: types[Number(cl.id.slice(1))] || `观点簇 ${i + 1}`,
    axisHint: { x: "来源类型分布", y: "" },
  }));
  return { clusters, axisHint: { x: "来源类型分布", y: "" }, points, mode: "rule" };
}

/** 单簇兜底（回答 < 3 条） */
function singleClusterFallback(items: AnswerProfile[]): GenealogyResult {
  const points = items.map((p, i) => ({
    id: p.id,
    x: round(Math.cos((i / Math.max(items.length, 1)) * Math.PI * 2) * 0.5),
    y: round(Math.sin((i / Math.max(items.length, 1)) * Math.PI * 2) * 0.5),
    cluster: "c0",
    sourceTitle: p.sourceTitle,
    claim: p.claim,
    period: p.postTime ? p.postTime.slice(0, 7) : "",
    postTimeSource: p.postTimeSource,
    votes: p.votes,
    url: p.url,
    sourceType: p.sourceType,
  }));
  const timeDist: Record<string, number> = {};
  for (const p of items) {
    const ym = p.postTime ? p.postTime.slice(0, 7) : "未知";
    timeDist[ym] = (timeDist[ym] || 0) + 1;
  }
  return {
    clusters: [{ id: "c0", label: "全部观点", size: items.length, centroid2D: [0, 0], axisHint: { x: "", y: "" }, members: items.map((p) => p.id), timeDistribution: timeDist }],
    axisHint: { x: "经验 ↔ 理论", y: "正向 ↔ 批判" },
    points,
    mode: "rule",
  };
}
