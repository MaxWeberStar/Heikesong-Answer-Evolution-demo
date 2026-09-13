"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";

interface ListItem {
  id: string;
  kind: string;
  created_at: number;
  payload: {
    topic: string;
    savedAt: string;
    answerCount: number;
    categories: string[];
    top: { claim: string; votes: number; url: string }[];
    synthesis: { consensus: string[]; divergence: string[]; blindspot: string[] } | null;
  };
}

export default function ListsPage() {
  const router = useRouter();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState("local");

  // 清单主存储：浏览器 localStorage（AiWorks 无数据库写入；登录后按 uid 分桶）
  const storageKey = (u: string) => `ae_lists_${u}`;

  async function resolveUser(): Promise<string> {
    try {
      const r = await fetch("/api/auth/me");
      const j = await r.json();
      if (j.user?.uid) return `zh_${j.user.uid}`;
    } catch {}
    return "local";
  }

  function loadLocal(u: string) {
    setLoading(true);
    try {
      const raw = localStorage.getItem(storageKey(u));
      const arr: ListItem[] = raw ? JSON.parse(raw) : [];
      setItems(Array.isArray(arr) ? arr : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    resolveUser().then((u) => { setUser(u); loadLocal(u); });
  }, []);

  function remove(id: string) {
    const next = items.filter((x) => x.id !== id);
    setItems(next);
    try { localStorage.setItem(storageKey(user), JSON.stringify(next)); } catch {}
  }

  const reopen = (topic: string) => router.push(`/?topic=${encodeURIComponent(topic)}`);

  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>
      <TopNav />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "34px 24px 80px" }}>
        <div style={{ marginBottom: 16 }}>
          <p style={{ letterSpacing: ".08em", color: "#9aa0a8", fontSize: 12, margin: 0 }}>MY LIST · 收藏的话题</p>
          <h1 style={{ margin: "4px 0 0", fontSize: 26 }}>我的清单</h1>
          <p style={{ color: "#7a8089", fontSize: 13, marginTop: 6 }}>
            这里保存你分析过的话题演进结果，点卡片可重新打开分析。
            {user === "local" && <span style={{ color: "#b06a00" }}>（当前为本地未登录状态，登录后可跨设备同步 · v2）</span>}
          </p>
        </div>

        {loading ? (
          <div style={{ color: "#9aa0a8", fontSize: 13, padding: "20px 0" }}>加载中…</div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#9aa0a8" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>☆</div>
            <div style={{ fontSize: 14 }}>还没有收藏。分析一个话题后点「收藏到清单」即可保存到这里。</div>
            <button onClick={() => router.push("/")} style={goBtn}>去分析话题 →</button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((it) => (
              <div key={it.id} style={listCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <button onClick={() => reopen(it.payload.topic)} style={titleBtn}>「{it.payload.topic}」观点分析</button>
                      <span style={{ fontSize: 11.5, color: "#9aa0a8" }}>
                        {it.payload.answerCount} 条回答 · {new Date(it.payload.savedAt || it.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {it.payload.categories?.length > 0 && (
                      <div style={{ fontSize: 12, color: "#7a8089", marginTop: 5 }}>维度：{it.payload.categories.join("、")}</div>
                    )}
                    {it.payload.synthesis?.consensus?.length ? (
                      <div style={{ fontSize: 12.5, color: "#4a4f57", marginTop: 8, background: "#f8f9fc", borderRadius: 8, padding: "8px 11px" }}>
                        <span style={{ color: "#0a7d4d", fontWeight: 600 }}>共识：</span>{it.payload.synthesis.consensus[0]}
                      </div>
                    ) : it.payload.top?.[0] ? (
                      <div style={{ fontSize: 12.5, color: "#4a4f57", marginTop: 8 }}>
                        高赞：{it.payload.top[0].claim}（👍{it.payload.top[0].votes}）
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button onClick={() => reopen(it.payload.topic)} style={openBtn}>重新打开</button>
                    <button onClick={() => remove(it.id)} style={delBtn}>删除</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const listCard: React.CSSProperties = { background: "#fff", border: "1px solid #eef0f3", borderRadius: 14, padding: "16px 18px", boxShadow: "0 1px 3px rgba(20,25,40,.04)" };
const titleBtn: React.CSSProperties = { textAlign: "left", border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#1a1c1f" };
const openBtn: React.CSSProperties = { padding: "6px 13px", fontSize: 12.5, fontWeight: 600, color: "#fff", background: "linear-gradient(90deg,#2563eb,#7c3aed)", border: "none", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" };
const delBtn: React.CSSProperties = { padding: "6px 13px", fontSize: 12.5, color: "#b3261e", background: "#fdf2f2", border: "1px solid #f5d5d5", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" };
const goBtn: React.CSSProperties = { marginTop: 18, padding: "9px 20px", fontSize: 14, fontWeight: 600, color: "#fff", background: "linear-gradient(90deg,#2563eb,#7c3aed)", border: "none", borderRadius: 10, cursor: "pointer" };
