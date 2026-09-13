"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import type { HotTopic } from "@/lib/discover";

const CATS = ["全部", "社会", "科技", "职场", "情感", "财经", "教育", "娱乐", "其他"];

export default function DiscoverPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<HotTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [cat, setCat] = useState("全部");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/discover");
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error);
      setTopics(j.topics || []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // 点击问题/关键词 → 回首页并自动分析
  const goAnalyze = (kw: string) => {
    router.push(`/?topic=${encodeURIComponent(kw)}`);
  };

  const shown = cat === "全部" ? topics : topics.filter((t) => (t.category || "其他") === cat);

  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>
      <TopNav />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "34px 24px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
          <div>
            <p style={{ letterSpacing: ".08em", color: "#9aa0a8", fontSize: 12, margin: 0 }}>
              LIVE · 发现正在讨论的问题
            </p>
            <h1 style={{ margin: "4px 0 0", fontSize: 26 }}>知乎热榜 TOP 10</h1>
          </div>
          <button onClick={load} disabled={loading} style={refreshBtn}>
            {loading ? "加载中…" : "刷新热榜 ↻"}
          </button>
        </div>

        {/* 时事分类筛选 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)} style={catChip(cat === c)}>
              {c}
            </button>
          ))}
        </div>

        {err && (
          <div style={{ background: "#fdeaea", color: "#b3261e", padding: "11px 15px", borderRadius: 10, fontSize: 13 }}>
            热榜加载失败：{err}。可点击刷新重试。
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {shown.map((t) => (
            <div key={t.rank} style={hotItem}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={rankBadge(t.rank)}>{t.rank}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => goAnalyzeTopic(router, t)} style={titleBtn}>
                      {t.title}
                    </button>
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {t.category && <span style={catTag}>{t.category}</span>}
                    {t.keywords.map((kw) => (
                      <button key={kw} onClick={() => goAnalyze(kw)} style={kwChip}>
                        {kw}
                      </button>
                    ))}
                    {t.url && (
                      <a href={t.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#9aa0a8" }}>
                        原帖 ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        {!loading && shown.length === 0 && !err && (
          <div style={{ color: "#9aa0a8", fontSize: 13, padding: "16px 0" }}>该分类暂无话题。</div>
        )}
      </main>
    </div>
  );
}

// 点热榜标题 → 回首页分析。
// 携带 title 作为降级线索：若链接不是问题帖（专栏/视频/话题），首页会自动改按标题做话题分析。
function goAnalyzeTopic(router: ReturnType<typeof useRouter>, t: HotTopic) {
  if (t.url) {
    router.push(`/?qlink=${encodeURIComponent(t.url)}&title=${encodeURIComponent(t.title)}`);
  } else {
    // 无链接则直接按标题做话题分析
    router.push(`/?topic=${encodeURIComponent(t.title)}`);
  }
}

const refreshBtn: React.CSSProperties = { padding: "7px 14px", fontSize: 13, color: "#2563eb", background: "#eef4ff", border: "1px solid #cdd8ff", borderRadius: 9, cursor: "pointer" };
const hotItem: React.CSSProperties = { background: "#fff", border: "1px solid #eef0f3", borderRadius: 12, padding: "13px 15px" };
const rankBadge = (r: number): React.CSSProperties => ({ minWidth: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700, color: r <= 3 ? "#fff" : "#7a8089", background: r <= 3 ? "linear-gradient(135deg,#2563eb,#7c3aed)" : "#f0f2f5" });
const titleBtn: React.CSSProperties = { textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#1a1c1f" };
const catTag: React.CSSProperties = { fontSize: 11.5, padding: "2px 9px", borderRadius: 99, background: "#f0ebfc", color: "#7c3aed", fontWeight: 600 };
const kwChip: React.CSSProperties = { padding: "3px 10px", fontSize: 12, border: "1px solid #d5dae2", background: "#fafbfc", borderRadius: 99, cursor: "pointer", color: "#4a4f57" };
const catChip = (on: boolean): React.CSSProperties => ({ padding: "5px 13px", fontSize: 13, border: "1px solid " + (on ? "#3b82f6" : "#d5dae2"), background: on ? "#eef4ff" : "#fff", color: on ? "#2563eb" : "#4a4f57", borderRadius: 99, cursor: "pointer" });
