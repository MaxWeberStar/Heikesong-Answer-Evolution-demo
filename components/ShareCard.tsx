"use client";
import { useRef, useState } from "react";
import type { EvolutionResult } from "@/lib/evolution";

/** 分享：主按钮 → 弹窗集合（分享图 / 微博 / QQ / 微信） */
export default function ShareCard({ data }: { data: EvolutionResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);
  const [imgUrl, setImgUrl] = useState("");
  const [tip, setTip] = useState("");

  function draw(): string {
    const c = canvasRef.current!;
    const W = 720, H = 900;
    c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#2563eb"); g.addColorStop(0.55, "#7c3aed"); g.addColorStop(1, "#06b6d4");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 110);
    ctx.fillStyle = "#fff"; ctx.font = "bold 30px -apple-system,PingFang SC,sans-serif";
    ctx.fillText("答案演进论 · 知乎2026", 40, 55);
    ctx.font = "16px -apple-system,PingFang SC,sans-serif";
    ctx.fillText(`「${data.topic}」的观点演进`, 40, 88);

    let y = 160;
    ctx.fillStyle = "#1a1c1f"; ctx.font = "bold 22px sans-serif";
    ctx.fillText("演进脉络（真实回答）", 40, y); y += 20;
    ctx.strokeStyle = "#e6e8ec"; ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
    y += 30;
    const roleColor: Record<string, string> = { 初始: "#7c3aed", 补充: "#10b981", 质疑: "#ef4444", 新维度: "#2563eb" };
    for (const n of data.nodes.slice(0, 6)) {
      ctx.fillStyle = roleColor[n.role] || "#9aa0a8";
      ctx.beginPath(); ctx.arc(48, y - 5, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#9aa0a8"; ctx.font = "13px sans-serif";
      ctx.fillText(`${n.period} · ${n.role}`, 64, y);
      ctx.fillStyle = "#1a1c1f"; ctx.font = "15px sans-serif";
      const claim = n.claim.length > 30 ? n.claim.slice(0, 30) + "…" : n.claim;
      ctx.fillText(claim, 64, y + 22); y += 52;
    }
    y += 10;
    const synth: [string, string, string[]][] = [
      ["共识", "#0a7d4d", data.synthesis.consensus],
      ["分歧", "#b3261e", data.synthesis.divergence],
      ["盲区", "#b06a00", data.synthesis.blindspot],
    ];
    for (const [t, col, items] of synth) {
      ctx.fillStyle = col; ctx.font = "bold 16px sans-serif";
      ctx.fillText(t, 40, y); y += 22;
      ctx.fillStyle = "#4a4f57"; ctx.font = "13px sans-serif";
      for (const it of items.slice(0, 2)) {
        const s = it.length > 40 ? it.slice(0, 40) + "…" : it;
        ctx.fillText("· " + s, 48, y); y += 20;
      }
      y += 8;
    }
    ctx.fillStyle = "#9aa0a8"; ctx.font = "12px sans-serif";
    ctx.fillText("由「答案演进论」基于真实知乎回答生成 · 每个观点可溯源", 40, H - 30);
    const url = c.toDataURL("image/png");
    setImgUrl(url);
    return url;
  }

  function openModal() {
    setTip("");
    setOpen(true);
    setTimeout(() => draw(), 30); // 等 canvas 挂载
  }

  function downloadImg() {
    const url = imgUrl || draw();
    const a = document.createElement("a");
    a.href = url;
    a.download = `答案演进_${data.topic}.png`;
    a.click();
    setTip("分享图已下载，可直接发送到任意平台。");
  }

  const shareText = `「${data.topic}」的观点演进 - 答案演进论`;
  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const weiboUrl = `https://service.weibo.com/share/share.php?title=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`;
  const qqUrl = `https://connect.qq.com/widget/shareqq/index.html?title=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`;

  function openWin(url: string) {
    window.open(url, "_blank", "width=680,height=560");
  }
  function wechat() {
    navigator.clipboard?.writeText(pageUrl).catch(() => {});
    setTip("链接已复制。微信分享：粘贴链接，或点「下载分享图」后在微信中发送图片。");
  }

  return (
    <div style={{ marginTop: 14 }}>
      <button onClick={openModal} style={primary}>↗ 分享这份演进</button>
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {open && (
        <div onClick={() => setOpen(false)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={modal}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0 }}>分享「{data.topic}」的演进</h3>
              <button onClick={() => setOpen(false)} style={closeBtn}>✕</button>
            </div>

            {imgUrl && (
              <div style={{ maxHeight: "42vh", overflowY: "auto", marginBottom: 14, borderRadius: 10, border: "1px solid #eef0f3", background: "#fafbfc" }}>
                <img src={imgUrl} alt="分享图预览" style={{ width: "100%", display: "block", borderRadius: 10 }} />
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button onClick={downloadImg} style={shareOpt("#2563eb")}>⬇ 下载分享图</button>
              <button onClick={() => openWin(weiboUrl)} style={shareOpt("#e6162d")}>微博分享</button>
              <button onClick={() => openWin(qqUrl)} style={shareOpt("#12b7f5")}>QQ 分享</button>
              <button onClick={wechat} style={shareOpt("#07c160")}>微信分享</button>
            </div>

            {tip && <div style={{ marginTop: 12, background: "#eef4ff", color: "#2563eb", padding: "10px 13px", borderRadius: 9, fontSize: 12.8 }}>{tip}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const primary: React.CSSProperties = { padding: "8px 18px", fontSize: 13.5, fontWeight: 600, color: "#fff", background: "linear-gradient(90deg,#2563eb,#7c3aed)", border: "none", borderRadius: 9, cursor: "pointer" };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,20,35,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20 };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: "20px 22px", maxWidth: 460, width: "100%", maxHeight: "88vh", overflowY: "auto" };
const closeBtn: React.CSSProperties = { border: "none", background: "#f0f2f5", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 15 };
const shareOpt = (col: string): React.CSSProperties => ({ padding: "11px 0", fontSize: 13.5, fontWeight: 600, color: "#fff", background: col, border: "none", borderRadius: 10, cursor: "pointer" });
