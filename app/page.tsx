"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { classifyZhihuLink, questionIdOf } from "@/lib/zhihu-link";
import type { AnswerProfile, OriginAnchor, QuestionCategory } from "@/types";
import type { EvolutionResult } from "@/lib/evolution";
import type { GenealogyData } from "@/components/GenealogyMap";

// 分步加载：三个阶段，用于进度指示（体感更快）
type Stage = "collect" | "profile" | "trace" | "evolution" | "done";
const STAGE_LABEL: Record<Exclude<Stage, "done">, string> = {
  collect: "正在读取真实回答",
  profile: "正在为每条回答生成画像",
  trace: "正在核实观点的理论源头",
  evolution: "正在梳理观点的演进脉络",
};
const STAGE_ORDER: Exclude<Stage, "done">[] = ["collect", "profile", "trace", "evolution"];

const TimelineBoard = dynamic(() => import("@/components/TimelineBoard"), { ssr: false });
const EvolutionTimeline = dynamic(() => import("@/components/EvolutionTimeline"), { ssr: false });
const ShareCard = dynamic(() => import("@/components/ShareCard"), { ssr: false });
const GenealogyMap = dynamic(() => import("@/components/GenealogyMap"), { ssr: false });

const PRESETS = [
  { topic: "祛魅", icon: "✦", desc: "从韦伯理性化到对“祛魅”本身的反思" },
  { topic: "转行产品经理", icon: "📦", desc: "成功与失败的经验分享" },
  { topic: "AIGC应用", icon: "🤖", desc: "落地场景与真实体验" },
  { topic: "大模型微调", icon: "⚙️", desc: "方法、踩坑与效果" },
];

type View = "board" | "evolution" | "genealogy";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const params = useSearchParams();
  const [topic, setTopic] = useState("");
  const [qlink, setQlink] = useState("");
  const [loading, setLoading] = useState("");
  const [stage, setStage] = useState<Stage>("done");
  const [notice, setNotice] = useState(""); // 降级/提示类信息（非错误）
  const [err, setErr] = useState("");
  const [answers, setAnswers] = useState<AnswerProfile[]>([]);
  const [anchors, setAnchors] = useState<OriginAnchor[]>([]);
  const [cats, setCats] = useState<QuestionCategory[]>([]);
  const [stats, setStats] = useState<{ collected?: number; profiled?: number } | null>(null);
  const [evo, setEvo] = useState<EvolutionResult | null>(null);
  const [genealogy, setGenealogy] = useState<GenealogyData | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [recos, setRecos] = useState<{ title: string; url: string }[]>([]);
  const [llm, setLlm] = useState<boolean | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [current, setCurrent] = useState("");
  const [view, setView] = useState<View>("board");

  async function analyze(payload: any, label: string) {
    setErr(""); setNotice(""); setAnswers([]); setAnchors([]); setEvo(null); setStats(null); setGenealogy(null); setRecos([]); setCurrent(label);
    try {
      // 阶段 1+2：取数 + 画像（profile 接口一次完成，先让结果尽快上屏）
      setStage("profile"); setLoading(STAGE_LABEL.profile);
      const pr = await fetch("/api/profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, top: 10 }),
      });
      const pj = await pr.json();
      if (!pr.ok) throw new Error(pj.message || pj.error);
      const ans: AnswerProfile[] = pj.answers || [];
      // 画像先出：立即展示看板，后续溯源/演进渐进填充（体感更快）
      setAnswers(ans); setCats(pj.categories || []); setLlm(pj.llm); setStats(pj.stats || null);
      setView("board");

      // 阶段 3：溯源核实（失败不阻塞）
      setStage("trace"); setLoading(STAGE_LABEL.trace);
      try {
        const tr = await fetch("/api/trace", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: label, answers: ans }),
        });
        const tj = await tr.json();
        if (tr.ok) setAnchors(tj.anchors || []);
      } catch { /* 溯源失败不影响主结果 */ }

      // 阶段 4：演进脉络
      setStage("evolution"); setLoading(STAGE_LABEL.evolution);
      const er = await fetch("/api/evolution", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: label, answers: ans }),
      });
      const ej = await er.json();
      if (er.ok) setEvo(ej);
      loadRecos(label); // 更多发现：基于话题推荐相关问题
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStage("done"); setLoading("");
    }
  }

  const runTopic = (t?: string) => {
    const q = (t ?? topic).trim();
    if (!q) return;
    setTopic(q);
    analyze({ topic: q }, q);
  };
  const runLink = () => {
    const u = qlink.trim();
    if (!u) return;
    analyzeLink(u, "问题帖");
  };

  /**
   * 读取问题回答。链接可能是问题帖，也可能是专栏/视频/话题/外链。
   * - question：正常读取该问题下的回答做画像
   * - 其余类型：无法读取回答，自动降级为「用标题/关键词做话题分析」，并给出提示（不再抛错）
   * @param fallbackTitle 降级时用于检索的标题线索（如热榜标题），无则用链接本身
   */
  async function analyzeLink(u: string, fallbackTitle?: string) {
    setErr(""); setNotice("");
    const info = classifyZhihuLink(u);

    // 非问题帖 → 优雅降级为话题分析
    if (info.kind !== "question" || !info.questionUrl) {
      const kindText: Record<string, string> = {
        article: "这是一篇专栏文章", zvideo: "这是一条视频",
        topic: "这是一个话题页", external: "这是站外链接", unknown: "该链接无法定位到具体问题",
      };
      const seed = (fallbackTitle || "").trim();
      if (seed) {
        setNotice(`${kindText[info.kind] || "该链接不是知乎问题帖"}，已自动改为按「${seed}」做话题分析。`);
        setTopic(seed);
        analyze({ topic: seed }, seed);
      } else {
        setErr(`${kindText[info.kind] || "该链接不是知乎问题帖"}。请粘贴形如 https://www.zhihu.com/question/… 的问题链接，或直接在上方输入关键词分析。`);
      }
      return;
    }

    const qUrl = info.questionUrl;
    const qId = questionIdOf(qUrl);
    const qTopic = `问题_${qId || Date.now()}`; // 唯一缓存标识，避免不同问题帖缓存串味
    setAnswers([]); setAnchors([]); setEvo(null); setStats(null); setGenealogy(null); setRecos([]); setCurrent(fallbackTitle || "问题帖");
    try {
      setStage("collect"); setLoading(STAGE_LABEL.collect);
      const cr = await fetch(`/api/collect?mode=question&questionUrl=${encodeURIComponent(qUrl)}&top=10`);
      const cj = await cr.json();
      if (!cr.ok) throw new Error(cj.message || cj.error);
      const raws = cj.answers || [];
      // 问题读到但无回答 → 降级为话题分析（若有标题线索）
      if (!raws.length) {
        const seed = (fallbackTitle || "").trim();
        if (seed) {
          setNotice(`该问题暂未读取到回答，已改为按「${seed}」做话题分析。`);
          setTopic(seed); analyze({ topic: seed }, seed); return;
        }
        throw new Error("该问题暂未读取到回答，可换一个问题或改用关键词分析。");
      }

      setStage("profile"); setLoading(STAGE_LABEL.profile);
      const pr = await fetch("/api/profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: qTopic, answers: raws, top: 10 }),
      });
      const pj = await pr.json();
      if (!pr.ok) throw new Error(pj.message || pj.error);
      const ans = pj.answers || [];
      setAnswers(ans); setCats(pj.categories || []); setLlm(pj.llm); setStats(pj.stats || null);
      // 问题帖回答可由 answer id 反推时间 → 有时间则展示时间轴；老问题（早期自增ID无法反推）则退回演进卡片并说明
      const anyTime = ans.some((a: AnswerProfile) => a.postTime);
      setView(anyTime ? "board" : "evolution");
      if (!anyTime) {
        setNotice("这是较早的问题，回答多为知乎早期格式、无法还原发布时间，已为你展示「演进卡片」（观点的补充/质疑/新维度关系）。");
      }

      setStage("trace"); setLoading(STAGE_LABEL.trace);
      try {
        const tj = await fetch("/api/trace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: qTopic, answers: ans }) }).then((r) => r.json());
        setAnchors(tj.anchors || []);
      } catch { /* 溯源失败不阻塞 */ }

      setStage("evolution"); setLoading(STAGE_LABEL.evolution);
      const ej = await fetch("/api/evolution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: qTopic, answers: ans }) }).then((r) => r.json());
      setEvo(ej.error ? null : ej);
      // 更多发现：问题帖用标题线索做推荐种子（无则跳过）
      if (fallbackTitle) loadRecos(fallbackTitle);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStage("done"); setLoading("");
    }
  }

  // 从热榜独立页回跳：?topic= 或 ?qlink= 自动分析
  useEffect(() => {
    const t = params.get("topic");
    const q = params.get("qlink");
    const title = params.get("title") || undefined; // 热榜标题，降级时作为检索线索
    if (t) { setTopic(t); analyze({ topic: t }, t); }
    else if (q) { setQlink(q); analyzeLink(q, title); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  // 收藏当前话题分析到「我的清单」（存 localStorage，无数据库写入）
  async function saveToList() {
    if (!answers.length) return;
    setSaving(true);
    try {
      let user = "local";
      try { const me = await fetch("/api/auth/me").then((r) => r.json()); if (me.user?.uid) user = `zh_${me.user.uid}`; } catch {}
      const item = {
        id: `evolution_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: "evolution",
        created_at: Date.now(),
        payload: {
          topic: current,
          savedAt: new Date().toISOString(),
          answerCount: answers.length,
          categories: cats.map((c) => c.name),
          top: answers.slice(0, 3).map((a) => ({ claim: a.claim, votes: a.votes, url: a.url })),
          synthesis: evo?.synthesis ?? null,
        },
      };
      try {
        const key = `ae_lists_${user}`;
        const raw = localStorage.getItem(key);
        const arr = raw ? JSON.parse(raw) : [];
        // 同话题去重：移除旧的同名再插到最前
        const next = [item, ...(Array.isArray(arr) ? arr : []).filter((x: any) => x?.payload?.topic !== current)];
        localStorage.setItem(key, JSON.stringify(next));
        setSaved(true); setTimeout(() => setSaved(false), 2500);
      } catch { /* localStorage 不可用时静默 */ }
    } finally { setSaving(false); }
  }

  const hasResult = answers.length > 0;

  // 谱系仪懒加载：点该 tab 时才请求 /api/cluster（较重）
  async function loadGenealogy() {
    if (genealogy || genLoading || !answers.length) return;
    setGenLoading(true);
    try {
      const r = await fetch("/api/cluster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: current, answers }),
      });
      const j = await r.json();
      if (r.ok && !j.error) setGenealogy(j as GenealogyData);
    } finally {
      setGenLoading(false);
    }
  }
  const switchView = (v: View) => {
    setView(v);
    if (v === "genealogy") loadGenealogy();
  };

  // 更多发现：基于当前话题推荐相关问题（question recommend）
  async function loadRecos(seed: string) {
    const q = (seed || "").trim();
    if (!q || q.startsWith("问题_")) { setRecos([]); return; } // 问题帖入口无关键词，跳过
    try {
      const r = await fetch(`/api/recommend?topic=${encodeURIComponent(q)}&count=6`);
      const j = await r.json();
      if (r.ok && Array.isArray(j.items)) setRecos(j.items);
    } catch { /* 推荐失败不影响主流程 */ }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>
      <TopNav />
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 24px 80px" }}>
        {/* Hero */}
        <section style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <p style={{ letterSpacing: ".04em", color: "#9aa0a8", fontSize: 13, margin: 0 }}>
              一个问题，多种声音，一条理解的路径
            </p>
            <h1 style={{ fontSize: 29, margin: "10px 0 8px", lineHeight: 1.35 }}>
              观点<span style={{ color: "#2563eb" }}>从哪里来</span>，又<span style={{ color: "#7c3aed" }}>走向哪里</span>？
            </h1>
            <p style={{ color: "#4a4f57", margin: 0, fontSize: 14.5 }}>
              从真实回答出发，看见补充、质疑与新的理解。
            </p>
          </div>
          <div style={{ textAlign: "center" }}>
            <img src="/kanshan/hello.gif" alt="刘看山" style={{ width: 140, height: 140 }} />
            <div style={{ color: "#9aa0a8", fontSize: 12 }}>和刘看山一起，换个角度看问题</div>
          </div>
        </section>

        {/* 搜索卡片：关键词 + 链接双入口 */}
        <section id="discover" style={card}>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <span style={titleGradient}>答案演进：追踪你的话题</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input value={topic} onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && runTopic()}
              placeholder="输入你感兴趣的话题或关键词" style={inputStyle} />
            <button onClick={() => runTopic()} disabled={!!loading} style={btnStyle(!!loading)}>
              {loading || "追踪话题 →"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <input value={qlink} onChange={(e) => setQlink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && runLink()}
              placeholder="粘贴知乎问题链接，例如 https://www.zhihu.com/question/…" style={inputStyle} />
            <button onClick={runLink} disabled={!!loading} style={ghostBtnLg}>
              读取问题回答
            </button>
          </div>
          <p style={{ color: "#9aa0a8", fontSize: 12, margin: "10px 0 0" }}>
            关键词轨道：主题级检索热门回答；回答轨道：先定位一个具体问题，再读取该问题下的回答集合。真实知乎搜索已接入。
          </p>
        </section>

        {/* 4 个示例指引卡片 */}
        <section style={{ marginTop: 16 }}>
          <p style={{ color: "#9aa0a8", fontSize: 12.5, margin: "0 0 8px" }}>搜索话题关键词示例（点击直接分析）：</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {PRESETS.map((p) => (
              <button key={p.topic} onClick={() => runTopic(p.topic)} disabled={!!loading} style={presetCard}>
                <span style={{ fontSize: 22 }}>{p.icon}</span>
                <div style={{ textAlign: "left", flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.topic}</div>
                  <div style={{ color: "#7a8089", fontSize: 12.5 }}>{p.desc}</div>
                </div>
                <span style={{ color: "#2563eb", fontSize: 13 }}>进入 →</span>
              </button>
            ))}
          </div>
        </section>

        {/* 热榜发现：跳转独立热榜页（与顶部导航「热榜发现」同一入口，不再重复语义） */}
        <Link href="/discover" style={{ textDecoration: "none" }}>
          <div id="discover-panel" style={discoverEntry}>
            <div>
              <p style={{ letterSpacing: ".08em", color: "#9aa0a8", fontSize: 12, margin: 0 }}>
                LIVE · 不知道分析什么？从热榜找灵感
              </p>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#1a1c1f", marginTop: 3 }}>
                知乎热榜 TOP 10（按时事分类浏览）
              </div>
              <div style={{ color: "#7a8089", fontSize: 12.5, marginTop: 3 }}>
                点问题标题直接读取回答，或点关键词做话题分析——都会回到这里生成观点演进。
              </div>
            </div>
            <span style={{ color: "#2563eb", fontWeight: 600 }}>进入热榜 →</span>
          </div>
        </Link>

        {llm === false && <div style={note("#fdf3e2", "#b06a00")}>未配置 LLM，使用规则版降级画像（零成本可演示）。</div>}
        {notice && <div style={note("#eef7ff", "#0a5bd0")}>💡 {notice}</div>}
        {err && <div style={note("#fdeaea", "#b3261e")}>出错：{err}</div>}
        {loading && <StageProgress stage={stage} loading={loading} />}

        {/* 结果区：左右分栏 */}
        {hasResult && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "24px 0 8px", flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ margin: 0 }}>「{current}」观点分析</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => switchView("board")} style={tabBtn(view === "board")}>时间轴看板</button>
                <button onClick={() => switchView("evolution")} style={tabBtn(view === "evolution")}>演进卡片</button>
                <button onClick={() => switchView("genealogy")} style={tabBtn(view === "genealogy")}>观点谱系</button>
                <button onClick={() => setShowRaw(true)} style={ghostBtn}>原始回答（{answers.length}）</button>
                <button onClick={saveToList} disabled={saving || saved} style={saveBtn(saved)}>
                  {saved ? "✓ 已收藏" : saving ? "收藏中…" : "☆ 收藏到清单"}
                </button>
              </div>
            </div>
            {stats?.collected != null && (
              <p style={{ color: "#7a8089", fontSize: 12.5, margin: "0 0 4px" }}>
                📊 已拉取 <strong style={{ color: "#2563eb" }}>{stats.collected}</strong> 条真实回答
                {stats.profiled != null && stats.profiled < stats.collected && (
                  <>，对其中赞数 Top <strong style={{ color: "#7c3aed" }}>{stats.profiled}</strong> 条做深度画像</>
                )}
              </p>
            )}
            {cats.length > 0 && (
              <p style={{ color: "#7a8089", fontSize: 13, margin: "0 0 10px" }}>
                问题维度：{cats.map((c) => c.name).join("、")}
              </p>
            )}

            {view === "genealogy" ? (
              /* 观点谱系仪：2D 散点 + 时间滑块（全宽单栏） */
              <div style={card}>
                <div style={{ marginBottom: 4 }}>
                  <h3 style={{ margin: "0 0 2px" }}>观点谱系图</h3>
                  <p style={{ color: "#9aa0a8", fontSize: 12.5, margin: 0 }}>
                    相近观点聚成一簇，两轴为最能区分这些观点的对立维度；拖动下方时间滑块看观点簇如何逐步出现。
                  </p>
                </div>
                {genealogy ? (
                  <GenealogyMap data={genealogy} />
                ) : (
                  <div style={{ color: "#9aa0a8", fontSize: 13, padding: "30px 0", textAlign: "center" }}>
                    {genLoading ? "正在做观点聚类与降维…（首次约 10-20s）" : "点击「观点谱系」加载聚类分析。"}
                  </div>
                )}
              </div>
            ) : view === "evolution" ? (
              /* 演进卡片：全宽单栏（较长，不分栏） */
              <div style={card}>
                {evo ? <EvolutionTimeline data={evo} /> : <div style={{ color: "#9aa0a8", fontSize: 13 }}>演进卡片生成中…</div>}
                {evo && <ShareCard data={evo} />}
              </div>
            ) : (
              /* 时间轴看板：左右分栏（左看板 / 右溯源+高赞） */
              <div className="ae-split" style={splitWrap}>
                <div style={{ minWidth: 0 }}>
                  <div style={card}>
                    <TimelineBoard answers={answers} anchors={anchors} />
                  </div>
                </div>
                <aside style={{ minWidth: 0 }}>
                  <div style={card}>
                    <h3 style={{ margin: "0 0 10px" }}>观点溯源</h3>
                    {anchors.length > 0 ? (
                      anchors.map((a) => (
                        <div key={a.concept} style={{ marginBottom: 12, fontSize: 13 }}>
                          <strong>{a.concept}</strong>{" "}
                          <span style={{ color: a.verified ? "#0a7d4d" : "#b06a00" }}>
                            {a.verified ? "✅ 已核实" : "⚠ 未核实"}
                          </span>
                          <div style={{ color: "#4a4f57", marginTop: 2 }}>
                            {a.proposer ? `${a.proposer}｜` : ""}{a.time ? `${a.time}｜` : ""}{a.summary}
                          </div>
                        </div>
                      ))
                    ) : (
                      <SourceExplain answers={answers} />
                    )}
                  </div>
                  <div style={card}>
                    <h3 style={{ margin: "0 0 10px" }}>高赞观点</h3>
                    {answers.slice(0, 4).map((a) => (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{ display: "block", marginBottom: 10, textDecoration: "none", color: "inherit" }}>
                        <div style={{ fontSize: 13, color: "#1a1c1f" }}>{a.claim}</div>
                        <div style={{ fontSize: 11.5, color: "#9aa0a8" }}>
                          <span style={{ color: "#7c3aed" }}>{a.sourceType}</span> · 👍{a.votes} · {a.postTime} ↗
                        </div>
                      </a>
                    ))}
                  </div>
                </aside>
              </div>
            )}

            {/* 更多发现：基于当前话题推荐相关问题，引导继续探索（P2） */}
            {recos.length > 0 && (
              <div style={{ ...card, marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <h3 style={{ margin: 0 }}>🧭 更多发现</h3>
                  <span style={{ color: "#9aa0a8", fontSize: 12.5 }}>顺着这个话题，继续探索相关问题</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  {recos.map((r) => (
                    <button
                      key={r.url}
                      onClick={() => { setQlink(r.url); analyzeLink(r.url, r.title); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                      disabled={!!loading}
                      style={recoCard}
                    >
                      <span style={{ fontSize: 13.5, color: "#1a1c1f", fontWeight: 500 }}>{r.title}</span>
                      <span style={{ color: "#2563eb", fontSize: 12, whiteSpace: "nowrap", marginLeft: 8 }}>分析 →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* 原始回答弹窗 */}
      {showRaw && (
        <div onClick={() => setShowRaw(false)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={modal}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>原始回答 · {current}</h3>
              <button onClick={() => setShowRaw(false)} style={closeBtn}>✕</button>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {answers.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={rawItem}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong style={{ fontSize: 14 }}>{a.claim}</strong>
                    <span style={{ color: "#2563eb", fontWeight: 700, whiteSpace: "nowrap" }}>{a.votes} 赞</span>
                  </div>
                  <div style={{ color: "#7a8089", fontSize: 12, marginTop: 5 }}>
                    <span style={{ color: "#7c3aed" }}>{a.sourceType}</span>
                    {a.author ? ` · ${a.author}` : ""}{a.authorBadge ? ` · ${a.authorBadge}` : ""} · {a.postTime} ↗
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 溯源可解释：无锚点时展示来源型分布作为判定依据 */
function SourceExplain({ answers }: { answers: AnswerProfile[] }) {
  const dist: Record<string, number> = {};
  for (const a of answers) dist[a.sourceType] = (dist[a.sourceType] || 0) + 1;
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  const theory = dist["理论溯源型"] || 0;
  return (
    <div style={{ fontSize: 13, color: "#4a4f57" }}>
      <div style={{ marginBottom: 8 }}>
        本话题的 {answers.length} 条高赞回答中，来源类型分布为：
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {entries.map(([k, v]) => (
          <span key={k} style={{ fontSize: 12, padding: "2px 9px", borderRadius: 99, background: "#f0f2f5", color: "#4a4f57" }}>
            {k} × {v}
          </span>
        ))}
      </div>
      <div style={{ color: "#9aa0a8", fontSize: 12.5 }}>
        判定依据：仅「理论溯源型」回答会触发对理论/事件的全网核实。本话题此类回答
        {theory === 0 ? "为 0" : `仅 ${theory} 条`}，其余多为个人经验 / 社会共识型，故暂无可核实的理论源头。
        可切换「演进卡片」查看观点的补充/质疑/新维度关系。
      </div>
    </div>
  );
}

/** 分步加载进度指示：让 ~25s 的全链路有清晰的阶段反馈，体感更快 */
function StageProgress({ stage, loading }: { stage: Stage; loading: string }) {
  const curIdx = STAGE_ORDER.indexOf(stage as Exclude<Stage, "done">);
  return (
    <div style={{ ...note("#eef4ff", "#2563eb"), display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
        <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #93b4ff", borderTopColor: "#2563eb", borderRadius: "50%", animation: "ae-spin .8s linear infinite" }} />
        {loading}…
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {STAGE_ORDER.map((s, i) => {
          const done = curIdx > i;
          const active = curIdx === i;
          return (
            <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ height: 4, borderRadius: 99, background: done ? "#2563eb" : active ? "#93b4ff" : "#dbe4ff" }} />
              <span style={{ fontSize: 11, color: done || active ? "#2563eb" : "#9aa0a8" }}>
                {done ? "✓ " : active ? "" : ""}{STAGE_LABEL[s].replace("正在", "")}
              </span>
            </div>
          );
        })}
      </div>
      <style>{"@keyframes ae-spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

const splitWrap: React.CSSProperties = { display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, alignItems: "start" };
const discoverEntry: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "linear-gradient(90deg,#eef4ff,#f5f0ff)", border: "1px solid #e3e9ff", borderRadius: 14, padding: "16px 20px", marginTop: 16, cursor: "pointer" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #eef0f3", borderRadius: 14, padding: "20px 22px", marginTop: 14, boxShadow: "0 1px 3px rgba(20,25,40,.04)" };
const titleBox: React.CSSProperties = { fontSize: 16, fontWeight: 700, padding: "6px 14px", border: "1.5px solid #2563eb", borderRadius: 10, color: "#1a1c1f", background: "linear-gradient(90deg,#eef4ff,#f5f0ff)" };
const titleGradient: React.CSSProperties = { fontSize: 22, fontWeight: 800, background: "linear-gradient(90deg,#1d4ed8 0%,#7c3aed 50%,#06b6d4 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" };
const inputStyle: React.CSSProperties = { flex: 1, padding: "12px 15px", fontSize: 15, border: "1px solid #d5dae2", borderRadius: 10, outline: "none" };
const btnStyle = (loading: boolean): React.CSSProperties => ({ padding: "0 22px", fontSize: 15, fontWeight: 600, color: "#fff", background: loading ? "#93b4ff" : "linear-gradient(90deg,#2563eb,#7c3aed)", border: "none", borderRadius: 10, cursor: loading ? "default" : "pointer", whiteSpace: "nowrap" });
const ghostBtnLg: React.CSSProperties = { padding: "0 18px", fontSize: 14, color: "#2563eb", background: "#eef4ff", border: "1px solid #cdd8ff", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap" };
const presetCard: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fff", border: "1px solid #eef0f3", borderRadius: 12, cursor: "pointer", boxShadow: "0 1px 3px rgba(20,25,40,.04)" };
const ghostBtn: React.CSSProperties = { padding: "7px 14px", fontSize: 13, color: "#2563eb", background: "#eef4ff", border: "1px solid #cdd8ff", borderRadius: 9, cursor: "pointer" };
const saveBtn = (saved: boolean): React.CSSProperties => ({ padding: "7px 14px", fontSize: 13, fontWeight: 600, color: saved ? "#0a7d4d" : "#7c3aed", background: saved ? "#e8f6ef" : "#f5f0ff", border: "1px solid " + (saved ? "#a7e3c6" : "#e0d3fb"), borderRadius: 9, cursor: saved ? "default" : "pointer" });
const recoCard: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", padding: "12px 14px", background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, cursor: "pointer" };
const tabBtn = (on: boolean): React.CSSProperties => ({ padding: "7px 14px", fontSize: 13, fontWeight: 600, color: on ? "#fff" : "#4a4f57", background: on ? "linear-gradient(90deg,#2563eb,#7c3aed)" : "#f0f2f5", border: "none", borderRadius: 9, cursor: "pointer" });
const note = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, padding: "11px 15px", borderRadius: 10, fontSize: 13.5, marginTop: 12 });
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,20,35,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: "20px 22px", maxWidth: 640, width: "100%", maxHeight: "80vh", overflowY: "auto" };
const closeBtn: React.CSSProperties = { border: "none", background: "#f0f2f5", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 15 };
const rawItem: React.CSSProperties = { display: "block", background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, padding: "12px 14px", textDecoration: "none", color: "inherit" };
