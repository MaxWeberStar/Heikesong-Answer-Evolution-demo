"use client";
import { useState } from "react";
import ReactECharts from "echarts-for-react";
import type { AnswerProfile, OriginAnchor } from "@/types";

// 来源类型 → 颜色（柔和蓝紫绿橙，白底舒适）
const TYPE_COLORS: Record<string, string> = {
  生活经验型: "#3b82f6",
  理论溯源型: "#8b5cf6",
  社会共识型: "#f59e0b",
  心理机制型: "#10b981",
  未分类: "#9aa0a8",
};
const EXTRA = ["#ec4899", "#06b6d4", "#f97316", "#84cc16"];
function colorOf(t: string, i: number) {
  return TYPE_COLORS[t] || EXTRA[i % EXTRA.length];
}

type Gran = "day" | "month" | "year";

interface Props {
  answers: AnswerProfile[];
  anchors?: OriginAnchor[];
}

/** 按粒度把日期归一到桶标签 */
function bucketOf(dateStr: string, gran: Gran): string {
  if (!dateStr) return "";
  if (gran === "year") return dateStr.slice(0, 4);
  if (gran === "month") return dateStr.slice(0, 7);
  return dateStr.slice(0, 10);
}

/** 生成连续桶序列（补齐中间空档，使时间轴均匀） */
function buildBuckets(dates: string[], gran: Gran): string[] {
  const set = new Set(dates.map((d) => bucketOf(d, gran)));
  if (set.size === 0) return [];
  const arr = Array.from(set).sort();
  if (gran === "day") return arr; // 天粒度不补齐，避免过长
  const out: string[] = [];
  if (gran === "year") {
    const lo = parseInt(arr[0], 10);
    const hi = parseInt(arr[arr.length - 1], 10);
    for (let y = lo; y <= hi; y++) out.push(String(y));
  } else {
    // month
    const [ly, lm] = arr[0].split("-").map(Number);
    const [hy, hm] = arr[arr.length - 1].split("-").map(Number);
    let y = ly, m = lm;
    while (y < hy || (y === hy && m <= hm)) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  return out;
}

export default function TimelineBoard({ answers, anchors = [] }: Props) {
  const [gran, setGran] = useState<Gran>("month");

  const withTime = answers.filter((a) => a.postTime);
  const types = Array.from(new Set(withTime.map((a) => a.sourceType)));
  const typeIndex = new Map(types.map((t, i) => [t, i]));
  // 问题帖入口有时间但无赞数（votes 全 0）→ 用统一点大小，避免全部缩成最小点
  const hasVotes = withTime.some((a) => a.votes > 0);

  const buckets = buildBuckets(withTime.map((a) => a.postTime), gran);
  const bucketIndex = new Map(buckets.map((b, i) => [b, i]));

  // 问题帖读取的回答无 EditTime/VoteUpCount，时间轴不适用 → 友好提示
  if (withTime.length === 0) {
    return (
      <div style={{ padding: "30px 16px", textAlign: "center", color: "#9aa0a8", fontSize: 13.5 }}>
        该来源的回答不含发布时间/赞数字段（知乎问题回答列表为精简数据），
        <br />时间轴看板不适用。请切换「演进卡片」查看观点的补充 / 质疑 / 新维度关系。
      </div>
    );
  }

  // 同一桶+同一行的点做轻微抖动，避免完全重叠
  const jitterCount = new Map<string, number>();

  const answerSeries = types.map((t, ti) => ({
    name: t,
    type: "scatter" as const,
    symbolSize: (val: any) => (hasVotes ? Math.max(12, Math.min(46, Math.sqrt(val[2]) * 3)) : 18),
    itemStyle: { color: colorOf(t, ti), opacity: 0.85, borderColor: "#fff", borderWidth: 1.5 },
    data: withTime
      .filter((a) => a.sourceType === t)
      .map((a) => {
        const b = bucketOf(a.postTime, gran);
        const bi = bucketIndex.get(b) ?? 0;
        const key = `${bi}_${ti}`;
        const k = jitterCount.get(key) || 0;
        jitterCount.set(key, k + 1);
        const jitter = (k % 3) * 0.12 - 0.12; // -0.12 / 0 / +0.12
        return { value: [bi, (typeIndex.get(t) ?? 0) + jitter, a.votes], raw: a };
      }),
  }));

  const anchorData = anchors.filter((x) => x.time);

  const option = {
    color: types.map((t, i) => colorOf(t, i)),
    tooltip: {
      trigger: "item",
      confine: true,
      borderColor: "#e6e8ec",
      textStyle: { fontSize: 12 },
      formatter: (p: any) => {
        const r = p.data?.raw;
        if (!r) return "";
        const meta = hasVotes ? `${r.votes}赞｜${r.postTime}` : `${r.postTime}（据回答ID推算）`;
        return `<b>${escapeHtml(r.claim)}</b><br/>来源型：${r.sourceType}｜立场：${
          r.stance || "—"
        }<br/>${r.author || "匿名"}${r.authorBadge ? " · " + r.authorBadge : ""}｜${meta}<br/><span style="color:#3b82f6">点击查看原文 ↗</span>`;
      },
    },
    legend: { top: 4, textStyle: { fontSize: 12 }, data: types },
    grid: { left: 130, right: 36, top: 44, bottom: 48 },
    xAxis: {
      type: "category",
      data: buckets,
      name: "时间",
      nameLocation: "middle",
      nameGap: 32,
      nameTextStyle: { color: "#9aa0a8", fontSize: 12 },
      boundaryGap: true,
      axisLine: { lineStyle: { color: "#cbd2da" } },
      splitLine: { show: false },
      axisLabel: { color: "#7a8089", interval: "auto", hideOverlap: true, rotate: buckets.length > 8 ? 30 : 0 },
    },
    yAxis: {
      type: "category",
      data: types,
      axisLine: { lineStyle: { color: "#cbd2da" } },
      axisLabel: { fontSize: 12, color: "#4a4f57" },
      splitLine: { show: true, lineStyle: { color: "#f0f2f5" } },
    },
    // 只读：不加 dataZoom，时间轴无法拖动
    series: answerSeries,
  };

  const onEvents = {
    click: (p: any) => {
      const r = p.data?.raw;
      if (r?.url) window.open(r.url, "_blank");
    },
  };

  const granBtns: { k: Gran; label: string }[] = [
    { k: "year", label: "年" },
    { k: "month", label: "月" },
    { k: "day", label: "日" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 4 }}>
        <span style={{ color: "#9aa0a8", fontSize: 12, alignSelf: "center", marginRight: 4 }}>
          时间粒度
        </span>
        {granBtns.map((b) => (
          <button
            key={b.k}
            onClick={() => setGran(b.k)}
            style={{
              padding: "3px 12px",
              fontSize: 12.5,
              borderRadius: 8,
              border: "1px solid " + (gran === b.k ? "#3b82f6" : "#d5dae2"),
              background: gran === b.k ? "#eef4ff" : "#fff",
              color: gran === b.k ? "#2563eb" : "#4a4f57",
              cursor: "pointer",
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
      <ReactECharts
        option={option}
        onEvents={onEvents}
        style={{ height: 420, width: "100%" }}
        notMerge
      />
      <p style={{ color: "#9aa0a8", fontSize: 12, margin: "6px 0 0" }}>
        {hasVotes
          ? "颜色=来源类型　大小=赞数（点击节点跳原文；右上切换时间粒度）"
          : "颜色=来源类型（该来源无赞数，点大小统一；时间据回答ID推算，点击节点跳原文）"}
      </p>
      {anchorData.length > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: "#f8f9fc",
            border: "1px dashed #d5dae2",
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 12, color: "#9aa0a8", marginBottom: 6 }}>
            ◆ 源头时间线（观点背后的理论/事件何时出现）
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {anchorData
              .slice()
              .sort((a, b) => (a.time! > b.time! ? 1 : -1))
              .map((x) => (
                <span
                  key={x.concept}
                  title={x.summary}
                  style={{
                    fontSize: 12.5,
                    padding: "4px 11px",
                    borderRadius: 8,
                    background: "#fff",
                    border: "1px solid " + (x.verified ? "#bbf7d0" : "#fde68a"),
                    color: "#1f2937",
                  }}
                >
                  <b>{x.time}</b>　{x.concept}
                  {x.proposer ? `（${x.proposer}）` : ""}
                  <span style={{ color: x.verified ? "#0a7d4d" : "#b06a00", marginLeft: 4 }}>
                    {x.verified ? "✅" : "⚠"}
                  </span>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return (s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}
