"use client";
import { useState, useRef, useEffect } from "react";

interface User {
  name: string;
  uid: string;
  avatar?: string;
}

type View = "board" | "evolution" | "genealogy" | "all";

interface TopNavProps {
  resultSpace?: boolean;
  view?: View;
  onViewChange?: (view: View) => void;
  onReturn?: () => void;
  onEmptyView?: () => void;
}

const VIEW_HINTS: Record<View, string> = {
  board: "看观点何时出现，以及来源类型如何分布。",
  evolution: "看哪些回答可能在补充、质疑或引入新维度。",
  genealogy: "看算法如何把相近回答归成观点簇。",
  all: "按顺序查看时间轴、演进卡片和观点谱系。",
};

export default function TopNav({ resultSpace = false, view = "board", onViewChange, onReturn, onEmptyView }: TopNavProps) {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [hoveredView, setHoveredView] = useState<View | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // 从服务端读登录态（真·知乎 OAuth 会话）
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => { if (j.user) setUser({ name: j.user.fullname, uid: j.user.uid, avatar: j.user.avatar }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, []);

  // 发起知乎 OAuth 登录（跳后端授权入口）
  const login = () => { window.location.href = "/api/auth/login"; };
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setOpen(false);
    window.location.reload();
  };

  return (
    <nav
      className="ae-top-nav"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(180px, 1fr) auto minmax(240px, 1fr)",
        alignItems: "center",
        padding: "14px 26px",
        borderBottom: "1px solid #eef0f3",
        background: "#fff",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div className="ae-brand"
        style={{
          fontSize: 19,
          fontWeight: 800,
          background: "linear-gradient(90deg,#1d4ed8 0%,#7c3aed 45%,#0ea5e9 80%,#06b6d4 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          letterSpacing: ".01em",
        }}
      >
        答案演进论 · 知乎2026
      </div>

      <div className="ae-view-nav" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
        {(["board", "evolution", "genealogy", "all"] as View[]).map((item) => (
          <div key={item} style={{ position: "relative" }} onMouseEnter={() => setHoveredView(item)} onMouseLeave={() => setHoveredView(null)}>
            <button
              onClick={() => resultSpace ? onViewChange?.(item) : onEmptyView?.()}
              title={VIEW_HINTS[item]}
              style={viewButton(view === item)}
            >
              {item === "board" ? "时间轴看板" : item === "evolution" ? "演进卡片" : item === "genealogy" ? "观点谱系" : "全部分析"}
            </button>
            {hoveredView === item && (
              <div style={viewTooltip}>
                {VIEW_HINTS[item]}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="ae-nav-actions" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 18 }}>
        <a href={resultSpace ? undefined : "/"} onClick={resultSpace ? (e) => { e.preventDefault(); onReturn?.(); } : undefined} style={{ color: "#1a1c1f", textDecoration: "none", fontSize: 14 }}>
          分析话题{resultSpace ? "（返回）" : ""}
        </a>
        <a href="/discover" style={{ color: "#1a1c1f", textDecoration: "none", fontSize: 14 }}>
          热榜发现
        </a>
        <a href="/lists" style={{ color: "#1a1c1f", textDecoration: "none", fontSize: 14 }}>
          我的清单
        </a>

        {!user ? (
          <button
            onClick={login}
            style={{
              padding: "7px 16px",
              fontSize: 13.5,
              fontWeight: 600,
              color: "#2563eb",
              background: "#fff",
              border: "1px solid #cdd8ff",
              borderRadius: 20,
              cursor: "pointer",
            }}
          >
            知乎登录 ↗
          </button>
        ) : (
          <div ref={ref} style={{ position: "relative" }}>
            <div
              onClick={() => setOpen((v) => !v)}
              title={user.name}
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: user.avatar ? `center/cover no-repeat url(${user.avatar})` : "linear-gradient(135deg,#2563eb,#7c3aed)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                border: "2px solid #e8edff",
              }}
            >
              {user.avatar ? "" : user.name.slice(0, 1)}
            </div>
            {open && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 44,
                  minWidth: 180,
                  background: "#fff",
                  border: "1px solid #e6e8ec",
                  borderRadius: 12,
                  boxShadow: "0 8px 28px rgba(20,25,40,.12)",
                  padding: "12px 14px",
                }}
              >
                {/* 小三角 */}
                <div
                  style={{
                    position: "absolute",
                    right: 12,
                    top: -6,
                    width: 12,
                    height: 12,
                    background: "#fff",
                    borderLeft: "1px solid #e6e8ec",
                    borderTop: "1px solid #e6e8ec",
                    transform: "rotate(45deg)",
                  }}
                />
                <div style={{ fontWeight: 700, fontSize: 14 }}>{user.name}</div>
                <div style={{ color: "#9aa0a8", fontSize: 12, marginTop: 2 }}>UID: {user.uid}</div>
                <div style={{ height: 1, background: "#f0f2f5", margin: "10px 0" }} />
                <button
                  onClick={logout}
                  style={{
                    width: "100%",
                    padding: "7px 0",
                    fontSize: 13,
                    color: "#b3261e",
                    background: "#fdf2f2",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <style>{`
        @media (max-width: 860px) {
          .ae-top-nav { grid-template-columns: 1fr auto; gap: 10px 14px; }
          .ae-view-nav { grid-column: 1 / -1; grid-row: 2; overflow-x: auto; justify-content: flex-start !important; padding-top: 2px; }
          .ae-brand { font-size: 17px !important; }
          .ae-nav-actions { gap: 10px !important; }
        }
        @media (max-width: 560px) {
          .ae-top-nav { padding: 10px 14px !important; }
          .ae-brand { font-size: 16px !important; }
          .ae-view-nav button { font-size: 13px !important; padding: 7px 10px !important; }
          .ae-nav-actions a { font-size: 12px !important; }
          .ae-nav-actions { gap: 8px !important; }
        }
      `}</style>
    </nav>
  );
}

const viewButton = (active: boolean): React.CSSProperties => ({
  padding: "8px 13px",
  fontSize: 14.5,
  fontWeight: 700,
  color: active ? "#fff" : "#4a4f57",
  background: active ? "linear-gradient(90deg,#2563eb,#7c3aed)" : "#f0f2f5",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const viewTooltip: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  zIndex: 60,
  width: 190,
  padding: "8px 10px",
  color: "#fff",
  background: "rgba(26,28,31,.88)",
  borderRadius: 7,
  boxShadow: "0 5px 18px rgba(20,25,40,.18)",
  fontSize: 12,
  lineHeight: 1.45,
  pointerEvents: "none",
};
