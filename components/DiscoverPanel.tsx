"use client";
import { useState } from "react";

interface HotTopic {
  rank: number;
  title: string;
  url?: string;
  keywords: string[];
}

export default function DiscoverPanel({ onPick }: { onPick: (kw: string) => void }) {
  const [topics, setTopics] = useState<HotTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/discover");
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error);
      setTopics(j.topics || []);
      setLoaded(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="discover-panel" style={{ marginTop: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <p style={{ letterSpacing: ".08em", color: "#9aa0a8", fontSize: 12, margin: 0 }}>
            LIVE · 发现正在讨论的问题
          </p>
          <h3 style={{ margin: "3px 0 0" }}>知乎热榜 TOP 10</h3>
        </div>
        <button onClick={load} disabled={loading} style={refreshBtn}>
          {loading ? "加载中…" : loaded ? "刷新热榜 ↻" : "加载热榜 ↻"}
        </button>
      </div>

      {err && (
        <div style={{ background: "#fdeaea", color: "#b3261e", padding: "11px 15px", borderRadius: 10, fontSize: 13 }}>
          热榜加载失败：{err}。可点击重试。
        </div>
      )}

      {!loaded && !err && (
        <div style={{ color: "#9aa0a8", fontSize: 13, padding: "10px 0" }}>
          点击右上「加载热榜」查看当前正在被讨论的 TOP10 问题，每条附可点击的关键词。
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {topics.map((t) => (
          <div key={t.rank} style={hotItem}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={rankBadge(t.rank)}>{t.rank}</span>
              <div style={{ flex: 1 }}>
                <a href={t.url} target="_blank" rel="noreferrer" style={{ color: "#1a1c1f", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
                  {t.title} <span style={{ color: "#9aa0a8", fontWeight: 400 }}>↗</span>
                </a>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                  {t.keywords.map((kw) => (
                    <button key={kw} onClick={() => onPick(kw)} style={kwChip}>
                      {kw}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const refreshBtn: React.CSSProperties = {
  padding: "7px 14px", fontSize: 13, color: "#2563eb", background: "#eef4ff",
  border: "1px solid #cdd8ff", borderRadius: 9, cursor: "pointer",
};
const hotItem: React.CSSProperties = {
  background: "#fff", border: "1px solid #eef0f3", borderRadius: 12, padding: "13px 15px",
};
const rankBadge = (r: number): React.CSSProperties => ({
  minWidth: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 12.5, fontWeight: 700, color: r <= 3 ? "#fff" : "#7a8089",
  background: r <= 3 ? "linear-gradient(135deg,#2563eb,#7c3aed)" : "#f0f2f5",
});
const kwChip: React.CSSProperties = {
  padding: "3px 10px", fontSize: 12, border: "1px solid #d5dae2", background: "#fafbfc",
  borderRadius: 99, cursor: "pointer", color: "#4a4f57",
};
