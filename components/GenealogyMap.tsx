"use client";
import { useState, useMemo } from "react";
import ReactECharts from "echarts-for-react";

export interface GenealogyPoint {
  id: string; x: number; y: number; cluster: string;
  claim: string; period: string; votes: number; url: string; sourceType: string;
}
export interface GenealogyCluster {
  id: string; label: string; size: number;
  centroid2D: [number, number];
  members: string[];
  timeDistribution: Record<string, number>;
}
export interface GenealogyData {
  clusters: GenealogyCluster[];
  axisHint: { x: string; y: string };
  points: GenealogyPoint[];
  mode: "embedding" | "llm" | "rule";
}

const CLUSTER_COLORS = ["#2563eb", "#7c3aed", "#f59e0b", "#10b981", "#ec4899", "#06b6d4"];
function clusterColor(cid: string, order: string[]) {
  const i = order.indexOf(cid);
  return CLUSTER_COLORS[(i < 0 ? 0 : i) % CLUSTER_COLORS.length];
}

export default function GenealogyMap({ data }: { data: GenealogyData }) {
  const { clusters, axisHint, points, mode } = data;
  const clusterOrder = clusters.map((c) => c.id);
  const labelOf = new Map(clusters.map((c) => [c.id, c.label]));

  // 时间滑块：收集所有 period（升序），滑块选“截至某时间”
  const periods = useMemo(
    () => Array.from(new Set(points.map((p) => p.period).filter(Boolean))).sort(),
    [points]
  );
  const [sliderIdx, setSliderIdx] = useState(periods.length - 1);
  const cutoff = periods[sliderIdx] ?? "9999-99";
  const [activeCluster, setActiveCluster] = useState<string | null>(null);

  // 过滤：只显示 period <= cutoff 的点（无 period 的始终显示）
  const visible = points.filter((p) => !p.period || p.period <= cutoff);

  // 按簇分组做散点 series
  const series = clusters.map((cl) => ({
    name: cl.label,
    type: "scatter" as const,
    symbolSize: (val: any) => {
      const dimmed = activeCluster && activeCluster !== cl.id;
      return dimmed ? 8 : 16;
    },
    itemStyle: {
      color: clusterColor(cl.id, clusterOrder),
      opacity: activeCluster && activeCluster !== cl.id ? 0.25 : 0.9,
      borderColor: "#fff", borderWidth: 1.5,
    },
    data: visible
      .filter((p) => p.cluster === cl.id)
      .map((p) => ({ value: [p.x, p.y], raw: p })),
  }));

  const option = {
    tooltip: {
      trigger: "item", confine: true, borderColor: "#e6e8ec", textStyle: { fontSize: 12 },
      formatter: (p: any) => {
        const r = p.data?.raw;
        if (!r) return "";
        return `<b>${escapeHtml(r.claim)}</b><br/>簇：${labelOf.get(r.cluster) || r.cluster}｜${r.sourceType}<br/>${r.period || "时间未知"}${r.votes > 0 ? "｜👍" + r.votes : ""}<br/><span style="color:#2563eb">点击查看原文 ↗</span>`;
      },
    },
    legend: { top: 4, textStyle: { fontSize: 12 }, data: clusters.map((c) => c.label) },
    grid: { left: 48, right: 30, top: 40, bottom: 54 },
    xAxis: {
      type: "value", min: -1.15, max: 1.15, name: axisHint.x, nameLocation: "middle", nameGap: 28,
      nameTextStyle: { color: "#7c3aed", fontSize: 12.5, fontWeight: 600 },
      axisLine: { lineStyle: { color: "#cbd2da" } }, splitLine: { lineStyle: { color: "#f0f2f5" } },
      axisLabel: { show: false },
    },
    yAxis: {
      type: "value", min: -1.15, max: 1.15, name: axisHint.y, nameLocation: "middle", nameGap: 18,
      nameTextStyle: { color: "#2563eb", fontSize: 12.5, fontWeight: 600 },
      axisLine: { lineStyle: { color: "#cbd2da" } }, splitLine: { lineStyle: { color: "#f0f2f5" } },
      axisLabel: { show: false },
    },
    series,
  };

  const onEvents = { click: (p: any) => { const r = p.data?.raw; if (r?.url) window.open(r.url, "_blank"); } };

  return (
    <div>
      {mode !== "embedding" && (
        <div style={{ fontSize: 12, color: "#b06a00", background: "#fdf3e2", borderRadius: 8, padding: "6px 11px", marginBottom: 10 }}>
          {mode === "llm" ? "未配置 Embedding，使用 LLM 直接归类（坐标为语义倾向估计）。" : "未配置 LLM/Embedding，使用规则版按来源类型分簇。"}
        </div>
      )}
      <ReactECharts option={option} onEvents={onEvents} style={{ height: 400, width: "100%" }} notMerge />

      {/* 时间滑块 */}
      {periods.length > 1 && (
        <div style={{ padding: "6px 8px 2px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9aa0a8", marginBottom: 4 }}>
            <span>时间演化：拖动看观点簇如何逐步出现</span>
            <span style={{ color: "#2563eb", fontWeight: 600 }}>截至 {cutoff}（{visible.length} 条）</span>
          </div>
          <input
            type="range" min={0} max={periods.length - 1} value={sliderIdx}
            onChange={(e) => setSliderIdx(Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#c0c4cc" }}>
            <span>{periods[0]}</span><span>{periods[periods.length - 1]}</span>
          </div>
        </div>
      )}

      {/* 簇侧栏：点击高亮 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8, marginTop: 12 }}>
        {clusters.map((cl) => {
          const on = activeCluster === cl.id;
          return (
            <button
              key={cl.id}
              onClick={() => setActiveCluster(on ? null : cl.id)}
              style={{
                textAlign: "left", cursor: "pointer",
                background: on ? "#f5f7ff" : "#fff",
                border: `1px solid ${on ? clusterColor(cl.id, clusterOrder) : "#eef0f3"}`,
                borderRadius: 10, padding: "9px 11px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: clusterColor(cl.id, clusterOrder), display: "inline-block" }} />
                <strong style={{ fontSize: 12.5, color: "#1a1c1f" }}>{cl.label}</strong>
              </div>
              <div style={{ fontSize: 11.5, color: "#9aa0a8" }}>{cl.size} 条观点</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function escapeHtml(s: string) {
  return (s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}
