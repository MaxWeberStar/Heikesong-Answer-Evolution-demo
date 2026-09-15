# 答案演进论 · answer-evolution

知乎问答观点的「时间演进 + 溯源」分析产品（黑客松 MVP）。

## 当前进度
- ✅ `lib/zhihu.ts` — 知乎 CLI 封装（search / question answers / hot / global / recommend / 配额守卫 + Top 排序）
- ✅ `lib/cache.ts` — 进程内存缓存（无数据库写入，AiWorks 友好）
- ✅ `app/api/{collect,profile,trace,evolution,cluster,recommend,discover,auth}` — 全链路接口
- ✅ P0 时间轴看板 / P1 观点谱系 / P2 我的清单(localStorage)+更多发现 / 知乎 OAuth 登录

## v2.0.0 迭代说明

v2.0.0 针对首版“结果多但不易理解、观点关系不够可信、长文本召回容易泛化”的问题进行了重构。
本版本将首页入口、结果摘要、阅读起点与时间轴看板、演进卡片、观点谱系统一到清晰的结果阅读空间；
对长文本查询增加主题、对象和问题意图解释，并将结果区分为核心结果与扩展阅读；同时在界面中明确区分
原文事实、模型分析和未核实信息。接入 OpenAI 兼容 LLM 后，系统可以动态生成问题维度、回答主张、
共识、分歧、盲区和观点之间的可能关系，并保留无模型配置时的规则降级路径。

本版本仍将模型生成的关系视为辅助分析，不宣称还原作者之间的真实回应关系；用户可以从每条结果回到知乎原文核对。

## v2.0.0 优化工作入口

v2.0.0 的工作路线、PRD、TDD 和复盘文档保存在本地工作区的项目根 `docs/` 目录中，
不随部署代码上传；部署运行只依赖本仓库中的代码、`render.yaml` 和 Render 环境变量。

## 快速开始
```bash
cp .env.example .env.local   # 按需填 LLM_API_KEY 等（取数不需要 key）
npm install
npm run cli:check 祛魅        # 不依赖 Next，直接验证取数链路
npm run dev                   # 打开 http://localhost:3000
```

> Access Secret 已由看山工作台配置在系统凭证库，CLI 直接可用，无需在本项目填写。

## 运行（无原生依赖，任意 Node 直接跑）
```bash
cp .env.example .env.local   # 按需填 LLM_API_KEY / OAuth 凭证
npm install
./run-dev.sh                 # 或 PORT=3900 ./run-dev.sh；改组件没更新用 CLEAN=1 ./run-dev.sh
```
> 本项目**已去除原生模块**：缓存用进程内存、我的清单用浏览器 localStorage、OAuth 会话用进程内 Map。
> 因此**不含数据库写入**，可用知乎 AiWorks 一键部署，也不再有 Node ABI 版本匹配问题。

## 路线图（现状）
- **P0 观点考古** ✅：多 query 累积取数 → LLM 答案画像 → search global 溯源 → ECharts 时间轴看板
- **P1 观点谱系仪** ✅：embedding → kmeans 聚类 → PCA 2D → LLM 命名两轴 → 2D 谱系图 + 时间滑块
- **P2** ✅：我的清单（SQLite）/ 更多发现（question recommend）
- **知乎 OAuth 登录** ✅：黑客松 OAuth 接入（见下），配置真实凭证即可切换真登录

详见同目录《产品需求文档PRD.md》《技术设计文档TDD.md》。

## 知乎 OAuth 登录（黑客松，评分项）
接入依据 skill `hackathon-oauth.md`。后端接口：
- `GET /api/auth/login` 发起授权（生成 state）
- `GET /api/auth/callback` 校验 state → 换 token → 拉用户 → 建 HttpOnly 会话
- `GET /api/auth/me` 读当前登录用户（仅公开字段，不含 token）
- `POST /api/auth/logout` 退出

**配置**（`.env.local`）：填入赛事页面分配的 `ZHIHU_OAUTH_APP_ID` / `ZHIHU_OAUTH_APP_KEY` /
`ZHIHU_OAUTH_REDIRECT_URI`（须与赛事页面登记值完全一致），并将 `ZHIHU_OAUTH_MOCK` 置空即为真登录。
未配置凭证时自动进入 **Mock 模式**，可演示完整登录闭环。

安全：App Key 与 OAuth Token 只留服务端；浏览器仅持 HttpOnly 会话 Cookie；uid 无损按字符串处理。

## 能力边界（实测 zhihu-cli 0.6.0）
- search zhihu 单次 ≤10（多 query 累积）；search global ≤20
- question answers / hot 配额各仅 100 → 强缓存
- question answers 为精简数据（无赞数/时间）→ 由 answer id（雪花ID）反推发布时间做时间轴
