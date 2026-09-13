"use client";
import { useState, useRef, useEffect } from "react";

interface User {
  name: string;
  uid: string;
  avatar?: string;
}

export default function TopNav() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
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
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 26px",
        borderBottom: "1px solid #eef0f3",
        background: "#fff",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div
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

      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <a href="/" style={{ color: "#1a1c1f", textDecoration: "none", fontSize: 14 }}>
          分析话题
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
    </nav>
  );
}
