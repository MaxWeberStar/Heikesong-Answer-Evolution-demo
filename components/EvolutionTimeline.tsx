"use client";
import type { EvolutionResult, EvoRole } from "@/lib/evolution";

const ROLE_STYLE: Record<EvoRole, { color: string; bg: string; symbol: string }> = {
  初始: { color: "#7c3aed", bg: "#f0ebfc", symbol: "●" },
  补充: { color: "#10b981", bg: "#e8f6ef", symbol: "●" },
  质疑: { color: "#ef4444", bg: "#fdeaea", symbol: "●" },
  新维度: { color: "#2563eb", bg: "#eef4ff", symbol: "◆" },
};

/** 角色对应的"回应动作"动词，让连线更像"谁在回应谁" */
function roleVerb(role: EvoRole): string {
  switch (role) {
    case "补充": return "补充了";
    case "质疑": return "质疑了";
    case "新维度": return "换个角度";
    default: return "承接";
  }
}

export default function EvolutionTimeline({ data }: { data: EvolutionResult }) {
  const { nodes, synthesis } = data;

  return (
    <div>
      <div
        style={{
          color: "#7a4b00",
          background: "#fff8e8",
          border: "1px solid #f1dca7",
          borderRadius: 10,
          padding: "10px 13px",
          fontSize: 12.5,
          lineHeight: 1.55,
          marginBottom: 14,
        }}
      >
        <strong>阅读边界：</strong>
        下方“补充 / 质疑 / 新维度”是基于回答主张和时间顺序的模型分析，不代表作者真实回应。
        每条关系都提供前后两条回答作为核对起点，请打开原文判断关系是否成立。
      </div>
      {/* 图例 */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          background: "#f8f9fc",
          borderRadius: 10,
          padding: "9px 14px",
          fontSize: 12.5,
          marginBottom: 16,
        }}
      >
        {(Object.keys(ROLE_STYLE) as EvoRole[]).map((r) => (
          <span key={r} style={{ color: "#4a4f57" }}>
            <span style={{ color: ROLE_STYLE[r].color, marginRight: 4 }}>{ROLE_STYLE[r].symbol}</span>
            {r === "初始" ? "初始观点" : r}
          </span>
        ))}
      </div>

      {/* 纵向时间线 */}
      <div style={{ position: "relative", paddingLeft: 26 }}>
        <div
          style={{
            position: "absolute",
            left: 7,
            top: 6,
            bottom: 6,
            width: 2,
            background: "#e6e8ec",
          }}
        />
        {nodes.map((n, idx) => {
          const st = ROLE_STYLE[n.role] || ROLE_STYLE["补充"];
          const prev = idx > 0 ? nodes[idx - 1] : null;
          return (
            <div key={n.id} style={{ position: "relative", marginBottom: 14 }}>
              {/* 关系连线：非首节点且有 relation 时，在节点上方显示"承接自上一观点"的连接说明 */}
              {prev && (
                <div style={{ position: "relative", marginBottom: 8, paddingLeft: 4 }}>
                  <div style={{ position: "absolute", left: -19, top: -6, bottom: -6, width: 2, borderLeft: `2px dashed ${st.color}`, opacity: 0.5 }} />
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5, fontSize: 12,
                    color: st.color, background: st.bg, padding: "7px 11px", borderRadius: 9,
                    border: `1px solid ${st.color}22`,
                  }}>
                    <span style={{ fontWeight: 700 }}>↳ {roleVerb(n.role)}前一条回答</span>
                    <span style={{ color: "#4a4f57" }}>
                      {n.relation || "未生成具体关系说明；仅按时间顺序展示，请回到原文核对。"}
                    </span>
                    <span style={{ color: "#7a8089", fontSize: 11.5 }}>
                      核对依据：前一条“{prev.claim}” → 当前“{n.claim}”
                    </span>
                    <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <a href={prev.url} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                        打开前一条原文 ↗
                      </a>
                      <a href={n.url} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                        打开当前原文 ↗
                      </a>
                    </span>
                  </div>
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  left: -23,
                  top: prev ? 76 : 16,
                  color: st.color,
                  fontSize: 15,
                  lineHeight: 1,
                }}
              >
                {st.symbol}
              </div>
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block",
                  background: "#fff",
                  border: "1px solid #eef0f3",
                  borderRadius: 12,
                  padding: "13px 16px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: "#9aa0a8" }}>{n.period}</span>{" "}
                    <strong>{n.actor}</strong>
                  </div>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: st.color,
                      background: st.bg,
                      padding: "2px 9px",
                      borderRadius: 99,
                    }}
                  >
                    {n.role}
                  </span>
                </div>
                <div style={{ margin: "8px 0" }}>
                  <div style={{ fontSize: 11.5, color: "#7a8089", marginBottom: 3 }}>
                    原文事实 · 标题
                  </div>
                  <div style={{ fontSize: 13, color: "#4a4f57" }}>
                    {n.sourceTitle || "知乎未返回标题"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#7c3aed", marginTop: 8, marginBottom: 3 }}>
                    模型分析 · 主张
                  </div>
                  <div style={{ fontSize: 14, color: "#1a1c1f" }}>{n.claim}</div>
                  {n.postTimeSource === "answer_id" && (
                    <div style={{ fontSize: 11.5, color: "#b06a00", marginTop: 5 }}>
                      未核实信息 · 时间由回答 ID 推算
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#9aa0a8" }}>
                  {n.votes >= 0 && <>👍 {n.votes}　</>}
                  {n.comments >= 0 && <>💬 {n.comments}　</>}
                  <span style={{ color: "#2563eb" }}>原文 ↗</span>
                </div>
              </a>
            </div>
          );
        })}
      </div>

      {/* 共识 / 分歧 / 盲区 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 20 }}>
        <SynthCard title="共识" color="#0a7d4d" bg="#e8f6ef" items={synthesis.consensus} />
        <SynthCard title="分歧" color="#b3261e" bg="#fdeaea" items={synthesis.divergence} />
        <SynthCard title="盲区" color="#b06a00" bg="#fdf3e2" items={synthesis.blindspot} />
      </div>
    </div>
  );
}

function SynthCard({
  title,
  color,
  bg,
  items,
}: {
  title: string;
  color: string;
  bg: string;
  items: string[];
}) {
  return (
    <div style={{ background: bg, borderRadius: 12, padding: "13px 15px" }}>
      <div style={{ fontWeight: 700, color, marginBottom: 8, fontSize: 14 }}>{title}</div>
      {items.length ? (
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.8, color: "#4a4f57" }}>
          {items.map((x, i) => (
            <li key={i} style={{ marginBottom: 5 }}>
              {x}
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12.5, color: "#9aa0a8" }}>—</div>
      )}
    </div>
  );
}
