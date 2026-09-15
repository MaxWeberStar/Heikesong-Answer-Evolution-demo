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

type View = "board" | "evolution" | "genealogy" | "all";
type SearchMode = "keyword" | "question";

type ReadingStart = {
  sourceTitle: string;
  claim: string;
  url: string;
  votes: number;
  sourceType: string;
  postTime: string;
  author: string;
  contentType?: "Answer" | "Article" | string;
  postTimeSource?: "api" | "answer_id" | "unknown";
  relevanceTier?: "core" | "extended";
  relevanceReason?: string;
};

type ResultSummaryView = {
  headline: string;
  consensus: string[];
  divergence: string[];
  limitation: string;
};

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
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState("");
  const [stage, setStage] = useState<Stage>("done");
  const [notice, setNotice] = useState(""); // 降级/提示类信息（非错误）
  const [err, setErr] = useState("");
  const [answers, setAnswers] = useState<AnswerProfile[]>([]);
  const [anchors, setAnchors] = useState<OriginAnchor[]>([]);
  const [cats, setCats] = useState<QuestionCategory[]>([]);
  const [stats, setStats] = useState<{
    collected?: number;
    profiled?: number;
    coreMatches?: number;
    extendedMatches?: number;
    collectedCoreMatches?: number;
    collectedExtendedMatches?: number;
    normalizedQuery?: string;
    queryTerms?: string[];
    querySubject?: string;
    queryIntent?: string;
    queryIgnoredTerms?: string[];
    queryExplanation?: string;
    longQuery?: boolean;
  } | null>(null);
  const [evo, setEvo] = useState<EvolutionResult | null>(null);
  const [genealogy, setGenealogy] = useState<GenealogyData | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [evoError, setEvoError] = useState("");
  const [evoLoading, setEvoLoading] = useState(false);
  const [recos, setRecos] = useState<{ title: string; url: string }[]>([]);
  const [llm, setLlm] = useState<boolean | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [current, setCurrent] = useState("");
  const [view, setView] = useState<View>("board");
  const [searchMode, setSearchMode] = useState<SearchMode>("keyword");
  const [resultSpace, setResultSpace] = useState(false);

  async function analyze(payload: any, label: string) {
    setErr(""); setNotice(""); setEvoError(""); setGenError(""); setAnswers([]); setAnchors([]); setEvo(null); setStats(null); setGenealogy(null); setRecos([]); setCurrent(label);
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
      setView("board"); setResultSpace(true);

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
    setTopic(q); setSearchInput(q);
    analyze({ topic: q }, q);
  };
  const runLink = () => {
    const u = (searchInput || qlink).trim();
    if (!u) return;
    setQlink(u);
    analyzeLink(u, undefined);
  };
  const runSearch = () => {
    const value = searchInput.trim();
    if (!value) return;
    if (searchMode === "keyword") runTopic(value);
    else runLink();
  };

  /**
   * 读取问题回答。链接可能是问题帖，也可能是专栏/视频/话题/外链。
   * - question：正常读取该问题下的回答做画像
   * - 其余类型：无法读取回答，自动降级为「用标题/关键词做话题分析」，并给出提示（不再抛错）
   * @param fallbackTitle 降级时用于检索的标题线索（如热榜标题），无则用链接本身
   */
  async function analyzeLink(u: string, fallbackTitle?: string) {
    setErr(""); setNotice(""); setEvoError(""); setGenError("");
    setAnswers([]); setAnchors([]); setEvo(null); setStats(null); setGenealogy(null); setRecos([]);
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
      const expandQuery = fallbackTitle ? `&expand=1&query=${encodeURIComponent(fallbackTitle)}` : "";
      const cr = await fetch(`/api/collect?mode=question&questionUrl=${encodeURIComponent(qUrl)}&top=10${expandQuery}`);
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
      setView("board"); setResultSpace(true);
      if (cj.expanded === false && fallbackTitle) {
        setNotice(cj.expansionMessage || "未找到足够相似的其他问答，当前仅分析该问题帖。");
      }
      // 无时间字段时，时间轴组件会显示边界提示；默认仍进入时间轴，保证三视图入口一致。
      const anyTime = ans.some((a: AnswerProfile) => a.postTime);
      if (!anyTime) {
        setNotice("这批回答无法可靠还原发布时间，时间轴会显示边界提示；可切换「演进卡片」查看观点关系。");
      }

      setStage("trace"); setLoading(STAGE_LABEL.trace);
      try {
        const tj = await fetch("/api/trace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: qTopic, answers: ans }) }).then((r) => r.json());
        setAnchors(tj.anchors || []);
      } catch { /* 溯源失败不阻塞 */ }

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
    if (t) { setTopic(t); setSearchInput(t); analyze({ topic: t }, t); }
    else if (q) { setQlink(q); setSearchInput(q); setSearchMode("question"); analyzeLink(q, title); }
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

  const withTimeCount = answers.filter((a) => a.postTime).length;
  const readingStarts: ReadingStart[] = answers
    .filter((a) => a.claim && a.url)
    .slice()
    .sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1))
    .slice(0, 3)
    .map((a) => ({
      sourceTitle: a.sourceTitle,
      claim: a.claim,
      url: a.url,
      votes: a.votes,
      sourceType: a.sourceType,
      postTime: a.postTime,
      author: a.author,
      contentType: a.contentType,
      postTimeSource: a.postTimeSource,
      relevanceTier: a.relevanceTier,
      relevanceReason: a.relevanceReason,
    }));
  const synthesis = evo?.synthesis;
  const sourceBreakdown = Object.entries(
    answers.reduce<Record<string, number>>((acc, answer) => {
      acc[answer.sourceType] = (acc[answer.sourceType] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} ${count} 条`)
    .join("、");
  const resultOverview = answers.length
    ? `本次实际整理了 ${answers.length} 条回答，主要由${sourceBreakdown || "未分类"}构成；${withTimeCount ? `${withTimeCount} 条带有可用时间字段` : "没有可用时间字段"}。这是一组围绕搜索词召回的回答集合，不等于对原始长文本的精确回答。`
    : "当前没有足够结果形成整体概要。";
  const queryRelation = stats?.longQuery
    ? `系统意图是「${stats.queryIntent || "待确认"}」，对象是「${stats.querySubject || "待确认"}」；当前召回结果与这层意图的关系，需以核心结果为主，扩展阅读只表示共享部分词语或背景，不代表已经回答了原问题。`
    : "";
  const summary: ResultSummaryView = {
    headline: synthesis?.consensus?.[0]
      ? `当前材料首先呈现出：${synthesis.consensus[0]}`
      : loading && !evo
        ? `已整理 ${answers.length} 条回答，正在继续整理观点关系。`
      : answers.length
        ? `已整理 ${answers.length} 条回答，先从高赞观点和来源类型分布开始阅读。`
        : "当前材料不足，暂不判断。",
    consensus: synthesis?.consensus?.slice(0, 2) || [],
    divergence: synthesis?.divergence?.slice(0, 2) || [],
    limitation: evoError
      ? evoError
      : !evo
        ? "演进摘要尚未完成，当前只展示已获取的回答画像和基础统计。"
        : withTimeCount === 0
          ? "这批回答没有可用发布时间，时间顺序只能按抓取顺序参考。"
          : evo.llm === false
            ? "演进关系使用规则版推断，不代表知乎官方观点或确定因果关系。"
            : "演进关系是基于回答主张的模型分析，具体依据请回到原文核对。",
  };

  // 谱系仪懒加载：点该 tab 时才请求 /api/cluster（较重）
  async function loadGenealogy() {
    if (genealogy || genLoading || !answers.length) return;
    setGenLoading(true);
    setGenError("");
    try {
      const r = await fetch("/api/cluster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: current, answers }),
      });
      const j = await r.json();
      if (r.ok && !j.error) setGenealogy(j as GenealogyData);
      else setGenError("观点谱系暂时无法生成，仍可使用时间轴和演进卡片。");
    } catch {
      setGenError("观点谱系暂时无法生成，仍可使用时间轴和演进卡片。");
    } finally {
      setGenLoading(false);
    }
  }
  async function loadEvolution() {
    if (evo || evoLoading || !answers.length) return;
    setEvoLoading(true);
    setEvoError("");
    try {
      const r = await fetch("/api/evolution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: current, answers }),
      });
      const j = await r.json();
      if (r.ok && !j.error) setEvo(j as EvolutionResult);
      else setEvoError("演进分析暂不可用，已保留时间轴和原始回答。");
    } catch {
      setEvoError("演进分析暂不可用，已保留时间轴和原始回答。");
    } finally {
      setEvoLoading(false);
    }
  }

  // 演进摘要直接服务结果首屏；分析完成后自动后台生成，点击视图时复用结果。
  useEffect(() => {
    if (resultSpace && answers.length && !evo && !evoLoading) {
      loadEvolution();
    }
    // 只在一轮分析得到新答案后触发，避免普通视图切换重复请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultSpace, answers]);

  const switchView = (v: View) => {
    if (!answers.length) {
      setNotice("请输入关键词或链接");
      return;
    }
    setView(v);
    if (v === "evolution") loadEvolution();
    if (v === "genealogy" || v === "all") loadGenealogy();
    if (v === "all") loadEvolution();
    const targetId = v === "evolution" ? "view-evolution" : v === "genealogy" ? "view-genealogy" : "view-board";
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const returnToSearch = () => {
    setResultSpace(false);
    setAnswers([]);
    setAnchors([]);
    setEvo(null);
    setGenealogy(null);
    setStats(null);
    setCats([]);
    setRecos([]);
    setLlm(null);
    setCurrent("");
    setNotice("");
    setErr("");
    setEvoError("");
    setGenError("");
    setView("board");
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
      <TopNav
        resultSpace={resultSpace}
        view={view}
        onViewChange={switchView}
        onReturn={returnToSearch}
        onEmptyView={() => setNotice("请输入关键词或链接")}
      />
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "34px 24px 80px" }}>
        {!resultSpace && (
          <>
        {/* Hero */}
        <section className="ae-hero" style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 6 }}>
          <div style={{ flex: 1 }}>
            <p style={{ letterSpacing: ".04em", color: "#9aa0a8", fontSize: 13, margin: 0 }}>
              从知乎回答里，找到复杂问题的阅读起点
            </p>
            <h1 style={{ fontSize: 29, margin: "10px 0 8px", lineHeight: 1.35 }}>
              答案演进论
            </h1>
            <h2 style={{ fontSize: 28, margin: "0 0 8px", lineHeight: 1.35, color: "#2563eb" }}>
              看见答案如何长出来
            </h2>
            <p style={{ color: "#4a4f57", margin: 0, fontSize: 14.5 }}>
              从真实知乎回答的时间、观点与来源关系，理解一个复杂问题如何形成分歧。
            </p>
          </div>
          <div style={{ textAlign: "center" }}>
            <img src="/kanshan/hello.gif" alt="刘看山" style={{ width: 140, height: 140 }} />
            <div style={{ color: "#9aa0a8", fontSize: 12 }}>和刘看山一起，换个角度看问题</div>
          </div>
        </section>

        {/* 搜索卡片：统一输入框 + 模式下拉 */}
        <section id="discover" style={card}>
          <div style={{ marginBottom: 14 }}>
            <span style={titleGradient}>从哪里开始？</span>
            <p style={{ color: "#7a8089", fontSize: 13, margin: "5px 0 0" }}>
              选择最接近你当前任务的入口，结果会回到同一套观点分析。
            </p>
          </div>
          <div className="ae-entry-row" style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <select
              value={searchMode}
              onChange={(e) => setSearchMode(e.target.value as SearchMode)}
              style={selectStyle}
              aria-label="选择分析方式"
            >
              <option value="keyword">关键词分析</option>
              <option value="question">问题帖分析</option>
            </select>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && runSearch()}
              placeholder={searchMode === "keyword" ? "输入话题或关键词，例如：祛魅" : "粘贴知乎问题链接，例如：https://www.zhihu.com/question/…"}
              style={inputStyle}
            />
            <button onClick={runSearch} disabled={!!loading} style={btnStyle(!!loading)}>
              {loading || (searchMode === "keyword" ? "分析关键词 →" : "分析问题帖 →")}
            </button>
          </div>
          <p style={{ color: "#7a8089", fontSize: 12, margin: "8px 0 0" }}>
            {searchMode === "keyword"
              ? "适合：还没有锁定具体问题，先从相近问答中看一个话题的主要观点和分歧。"
              : "适合：已经有明确问题；系统会先读取该问题，并在有标题线索时尝试扩展相近问答。"}
          </p>
        </section>

        {/* 4 个示例指引卡片 */}
        <section style={{ marginTop: 16 }}>
          <p style={{ color: "#9aa0a8", fontSize: 12.5, margin: "0 0 8px" }}>搜索话题关键词示例（点击直接分析）：</p>
          <div className="ae-presets" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
          </>
        )}

        {llm === false && <div style={note("#fdf3e2", "#b06a00")}>未配置 LLM，使用规则版降级画像（零成本可演示）。</div>}
        {notice && <div style={note("#eef7ff", "#0a5bd0")}>💡 {notice}</div>}
        {err && <div style={note("#fdeaea", "#b3261e")}>出错：{err}</div>}
        {loading && <StageProgress stage={stage} loading={loading} />}

        {/* 结果区：左右分栏 */}
        {hasResult && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "24px 0 8px", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0 }}>「{current}」分析结果</h3>
                  <p style={{ color: "#7a8089", fontSize: 12.5, margin: "4px 0 0" }}>
                    先读摘要和阅读起点，再选择一种视角深入查看。
                  </p>
                </div>
              <div className="ae-result-actions" style={{ display: "flex", gap: 8 }}>
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
            {stats?.longQuery && (
              <div style={{ ...note("#f7f8fb", "#4a4f57"), fontSize: 12.5, lineHeight: 1.7 }}>
                <div><strong>原始输入：</strong>{current}</div>
                <div><strong>用户意图解释：</strong>{stats.queryExplanation || "暂未形成结构化意图解释。"}</div>
                <div><strong>规范化查询：</strong>{stats.normalizedQuery || stats.queryTerms?.join(" ")}</div>
                {stats.queryIgnoredTerms?.length ? (
                  <div><strong>被降权的背景词：</strong>{stats.queryIgnoredTerms.join("、")}</div>
                ) : null}
                <div><strong>召回结果概要：</strong>{resultOverview}</div>
                <div><strong>逻辑关系：</strong>{queryRelation}</div>
                <div><strong>分层提示：</strong>当前画像中核心 {stats.coreMatches ?? 0} 条、扩展 {stats.extendedMatches ?? 0} 条；全部召回结果中核心 {stats.collectedCoreMatches ?? 0} 条、扩展 {stats.collectedExtendedMatches ?? 0} 条。扩展阅读仅作为补充线索，不能证明与原问题同等相关。</div>
              </div>
            )}
            {cats.length > 0 && (
              <p style={{ color: "#7a8089", fontSize: 13, margin: "0 0 10px" }}>
                问题维度：{cats.map((c) => c.name).join("、")}
              </p>
            )}

            <div style={{ ...card, marginTop: 12, background: "#f8faff", borderColor: "#dfe8ff" }}>
              <div style={{ fontWeight: 700, color: "#1a1c1f", marginBottom: 8 }}>结果摘要</div>
              <p style={{ color: "#4a4f57", fontSize: 14, lineHeight: 1.7, margin: "0 0 10px" }}>{summary.headline}</p>
              <div className="ae-summary-grid">
                <SummaryList
                  title="目前较接近的共识"
                  items={summary.consensus}
                  empty={evoLoading ? "正在生成共识摘要…" : evoError ? "共识摘要生成失败，已保留原始回答供核对。" : "暂未形成可用共识摘要。"}
                  color="#0a7d4d"
                />
                <SummaryList
                  title="值得优先核对的分歧"
                  items={summary.divergence}
                  empty={evoLoading ? "正在生成分歧摘要…" : evoError ? "分歧摘要生成失败，已保留原始回答供核对。" : "暂未形成可用分歧摘要。"}
                  color="#b3261e"
                />
              </div>
              <p style={{ color: "#7a8089", fontSize: 12, margin: "10px 0 0" }}>
                边界：{summary.limitation}
              </p>
            </div>

            <div style={{ ...card, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0 }}>阅读起点</h3>
                  <p style={{ color: "#7a8089", fontSize: 12.5, margin: "4px 0 0" }}>
                    先读这 {readingStarts.length} 条高赞且可跳转的回答，再决定深入哪个视图。
                  </p>
                </div>
                <span style={{ color: "#9aa0a8", fontSize: 12 }}>按赞数排序</span>
              </div>
              {readingStarts.length > 0 ? (
                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  {readingStarts.map((a, i) => (
                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer" style={readingStartItem}>
                      <span style={readingStartIndex}>{i + 1}</span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: "block", color: "#4a4f57", fontSize: 11.5 }}>
                          原文事实 · {a.sourceTitle || "知乎未返回标题"}
                        </span>
                        <span style={{ display: "block", color: "#1a1c1f", fontSize: 13.5, marginTop: 3 }}>
                          模型分析 · {a.claim}
                        </span>
                        <span style={{ display: "block", color: "#9aa0a8", fontSize: 11.5, marginTop: 4 }}>
                          {a.contentType === "Article" ? "专栏文章" : "高赞回答"} · {a.sourceType}{a.author ? ` · ${a.author}` : ""}{a.votes >= 0 ? ` · 👍${a.votes}` : ""}{a.postTime ? ` · ${a.postTime}` : " · 时间未知"}
                          {a.relevanceTier && ` · 模型分析 · ${a.relevanceTier === "core" ? "核心结果" : "扩展阅读"}`}
                          {a.postTimeSource === "answer_id" && " · 未核实时间"}
                        </span>
                      </span>
                      <span style={{ color: "#2563eb", fontSize: 12, whiteSpace: "nowrap" }}>读原文 ↗</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p style={{ color: "#9aa0a8", fontSize: 13, margin: "12px 0 0" }}>当前没有可跳转的回答，暂时从下方视图开始。</p>
              )}
            </div>

            {view === "genealogy" ? (
              /* 观点谱系仪：2D 散点 + 时间滑块（全宽单栏） */
              <div id="view-genealogy" style={{ ...card, scrollMarginTop: 92 }}>
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
                    {genError || (genLoading ? "正在做观点聚类与降维…（首次约 10-20s）" : "点击「观点谱系」加载聚类分析。")}
                  </div>
                )}
              </div>
            ) : view === "evolution" ? (
              /* 演进卡片：全宽单栏（较长，不分栏） */
              <div id="view-evolution" style={{ ...card, scrollMarginTop: 92 }}>
                {evo ? <EvolutionTimeline data={evo} /> : <div style={{ color: evoError ? "#b3261e" : "#9aa0a8", fontSize: 13 }}>{evoError || "演进卡片生成中…"}</div>}
                {evo && <ShareCard data={evo} />}
              </div>
            ) : view === "all" ? (
              <div style={{ display: "grid", gap: 16 }}>
                <div id="view-board" style={{ ...card, scrollMarginTop: 92 }}>
                  <h3 style={{ margin: "0 0 2px" }}>时间轴看板</h3>
                  <p style={{ color: "#9aa0a8", fontSize: 12.5, margin: "0 0 10px" }}>看观点何时出现，以及来源类型如何分布。</p>
                  <TimelineBoard answers={answers} anchors={anchors} />
                </div>
                <div id="view-evolution" style={{ ...card, scrollMarginTop: 92 }}>
                  <h3 style={{ margin: "0 0 2px" }}>演进卡片</h3>
                  <p style={{ color: "#9aa0a8", fontSize: 12.5, margin: "0 0 10px" }}>看哪些回答可能在补充、质疑或引入新维度。</p>
                  {evo ? <EvolutionTimeline data={evo} /> : <div style={{ color: evoError ? "#b3261e" : "#9aa0a8", fontSize: 13 }}>{evoError || (evoLoading ? "正在生成演进卡片…" : "演进卡片尚未生成。")}</div>}
                  {evo && <ShareCard data={evo} />}
                </div>
                <div id="view-genealogy" style={{ ...card, scrollMarginTop: 92 }}>
                  <h3 style={{ margin: "0 0 2px" }}>观点谱系</h3>
                  <p style={{ color: "#9aa0a8", fontSize: 12.5, margin: "0 0 10px" }}>看算法如何把相近回答归成观点簇。</p>
                  {genealogy ? <GenealogyMap data={genealogy} /> : <div style={{ color: genError ? "#b3261e" : "#9aa0a8", fontSize: 13 }}>{genError || (genLoading ? "正在做观点聚类与降维…" : "观点谱系尚未生成。")}</div>}
                </div>
              </div>
            ) : (
              /* 时间轴看板：左右分栏（左看板 / 右溯源+高赞） */
              <div className="ae-split" style={splitWrap}>
                <div id="view-board" style={{ minWidth: 0, scrollMarginTop: 92 }}>
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
                    <h3 style={{ margin: "0 0 10px" }}>高赞回答</h3>
                    {answers.slice(0, 4).filter((a) => a.url).map((a) => (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{ display: "block", marginBottom: 10, textDecoration: "none", color: "inherit" }}>
                        <div style={{ fontSize: 11.5, color: "#7a8089" }}>
                          原文事实 · {a.sourceTitle || "知乎未返回标题"}
                        </div>
                        <div style={{ fontSize: 13, color: "#1a1c1f", marginTop: 3 }}>
                          模型分析 · {a.claim}
                        </div>
                        <div style={{ fontSize: 11.5, color: "#9aa0a8" }}>
                          {a.contentType === "Article" ? "专栏文章" : "回答"} · <span style={{ color: "#7c3aed" }}>{a.sourceType}</span>{a.votes >= 0 ? ` · 👍${a.votes}` : ""} · {a.postTime}
                          {a.relevanceTier && ` · 模型分析 · ${a.relevanceTier === "core" ? "核心结果" : "扩展阅读"}`}
                          {a.postTimeSource === "answer_id" && " · 未核实时间"} ↗
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
      <style>{`
        .ae-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 720px) {
          .ae-summary-grid { grid-template-columns: 1fr; }
          .ae-hero { flex-direction: column; align-items: flex-start !important; gap: 16px !important; }
          .ae-hero img { width: 96px !important; height: 96px !important; }
          .ae-presets { grid-template-columns: 1fr !important; }
          .ae-entry-row { flex-direction: column; }
          .ae-entry-row input, .ae-entry-row button { width: 100%; min-height: 44px; box-sizing: border-box; }
          .ae-entry-row select { width: 100%; min-height: 44px; box-sizing: border-box; }
          .ae-result-actions { width: 100%; flex-wrap: wrap; }
          .ae-result-actions button { flex: 1 1 160px; min-height: 42px; }
        }
      `}</style>

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
                    <div style={{ fontSize: 11.5, color: "#7a8089" }}>
                      原文事实 · {a.sourceTitle || "知乎未返回标题"}
                    </div>
                    <strong style={{ display: "block", fontSize: 14, marginTop: 3 }}>
                      模型分析 · {a.claim}
                    </strong>
                    {a.votes >= 0 && <span style={{ color: "#2563eb", fontWeight: 700, whiteSpace: "nowrap" }}>{a.votes} 赞</span>}
                  </div>
                  <div style={{ color: "#7a8089", fontSize: 12, marginTop: 5 }}>
                    {a.contentType === "Article" ? "专栏文章" : "回答"} · <span style={{ color: "#7c3aed" }}>{a.sourceType}</span>
                    {a.author ? ` · ${a.author}` : ""}{a.authorBadge ? ` · ${a.authorBadge}` : ""} · {a.postTime}
                    {a.relevanceTier && ` · 模型分析 · ${a.relevanceTier === "core" ? "核心结果" : "扩展阅读"}`}
                    {a.postTimeSource === "answer_id" && " · 未核实时间"} ↗
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

function SummaryList({
  title,
  items,
  empty,
  color,
}: {
  title: string;
  items: string[];
  empty: string;
  color: string;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #eef0f3", borderRadius: 9, padding: "10px 12px" }}>
      <div style={{ color, fontWeight: 700, fontSize: 13, marginBottom: 5 }}>{title}</div>
      {items.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 16, color: "#4a4f57", fontSize: 12.5, lineHeight: 1.6 }}>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <div style={{ color: "#9aa0a8", fontSize: 12.5 }}>{empty}</div>
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
const selectStyle: React.CSSProperties = { padding: "0 12px", minWidth: 128, fontSize: 13.5, color: "#1a1c1f", background: "#f8f9fc", border: "1px solid #d5dae2", borderRadius: 10, outline: "none" };
const btnStyle = (loading: boolean): React.CSSProperties => ({ padding: "0 22px", fontSize: 15, fontWeight: 600, color: "#fff", background: loading ? "#93b4ff" : "linear-gradient(90deg,#2563eb,#7c3aed)", border: "none", borderRadius: 10, cursor: loading ? "default" : "pointer", whiteSpace: "nowrap" });
const ghostBtnLg: React.CSSProperties = { padding: "0 18px", fontSize: 14, color: "#2563eb", background: "#eef4ff", border: "1px solid #cdd8ff", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap" };
const presetCard: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fff", border: "1px solid #eef0f3", borderRadius: 12, cursor: "pointer", boxShadow: "0 1px 3px rgba(20,25,40,.04)" };
const ghostBtn: React.CSSProperties = { padding: "7px 14px", fontSize: 13, color: "#2563eb", background: "#eef4ff", border: "1px solid #cdd8ff", borderRadius: 9, cursor: "pointer" };
const saveBtn = (saved: boolean): React.CSSProperties => ({ padding: "7px 14px", fontSize: 13, fontWeight: 600, color: saved ? "#0a7d4d" : "#7c3aed", background: saved ? "#e8f6ef" : "#f5f0ff", border: "1px solid " + (saved ? "#a7e3c6" : "#e0d3fb"), borderRadius: 9, cursor: saved ? "default" : "pointer" });
const recoCard: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left", padding: "12px 14px", background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, cursor: "pointer" };
const note = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, padding: "11px 15px", borderRadius: 10, fontSize: 13.5, marginTop: 12 });
const readingStartItem: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "10px 11px", background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 9, textDecoration: "none", color: "inherit" };
const readingStartIndex: React.CSSProperties = { display: "grid", placeItems: "center", width: 24, height: 24, flex: "0 0 24px", borderRadius: "50%", background: "#eef4ff", color: "#2563eb", fontWeight: 700, fontSize: 12 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(15,20,35,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 };
const modal: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: "20px 22px", maxWidth: 640, width: "100%", maxHeight: "80vh", overflowY: "auto" };
const closeBtn: React.CSSProperties = { border: "none", background: "#f0f2f5", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 15 };
const rawItem: React.CSSProperties = { display: "block", background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, padding: "12px 14px", textDecoration: "none", color: "inherit" };
