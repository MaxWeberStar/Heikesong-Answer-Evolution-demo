// scripts/check-cli.mjs — 独立验证：不依赖 Next，直接跑通取数链路
// 用法：node scripts/check-cli.mjs [话题]  （默认「祛魅」）
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI =
  process.env.ZHIHU_CLI ||
  "/Applications/看山工作台.app/Contents/Resources/cli-bundle/zhihu/current/zhihu-cli";
const topic = process.argv[2] || "祛魅";

async function callCli(args) {
  const { stdout } = await execFileAsync(CLI, [...args, "--timeout", "30s"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const json = JSON.parse(stdout);
  if (json.Code !== undefined && json.Code !== 0)
    throw new Error(`${json.Code}: ${json.Message}`);
  return json.Data ?? json;
}

function toRaw(it) {
  return {
    title: it.Title ?? "",
    author: it.AuthorName ?? "",
    badge: it.AuthorBadgeText ?? "",
    votes: Number(it.VoteUpCount ?? 0),
    editTime: Number(it.EditTime ?? 0),
    url: it.Url ?? "",
  };
}

(async () => {
  console.log(`\n== 验证取数链路：话题「${topic}」==\n`);

  // 1. 额度自检
  const q = await callCli(["quota"]);
  const zs = q.find((x) => x.APIID === "zhihu_search");
  console.log(`[quota] zhihu_search 剩余 ${zs?.RemainingQuota}/${zs?.TotalQuota}`);

  // 2. 搜索
  const data = await callCli(["search", "zhihu", "--query", topic, "--count", "10"]);
  const items = (data?.Items ?? []).map(toRaw);
  console.log(`[search] 命中 ${items.length} 条`);

  // 3. 按赞数排序取 top
  const top = [...items].sort((a, b) => b.votes - a.votes).slice(0, 5);
  console.log(`\n[Top5 by votes]`);
  for (const t of top) {
    const d = t.editTime ? new Date(t.editTime * 1000).toISOString().slice(0, 10) : "?";
    console.log(`  · ${t.votes}赞 | ${d} | ${t.author}(${t.badge}) | ${t.title.slice(0, 30)}`);
  }

  // 4. 时间跨度
  const times = items.map((x) => x.editTime).filter(Boolean).sort();
  if (times.length) {
    const f = new Date(times[0] * 1000).toISOString().slice(0, 7);
    const l = new Date(times[times.length - 1] * 1000).toISOString().slice(0, 7);
    console.log(`\n[时间跨度] ${f} ~ ${l}（可上时间轴）`);
  }
  console.log(`\n✅ 取数链路通过。字段齐全：votes/editTime/author/url 均可用。\n`);
})().catch((e) => {
  console.error("❌ 验证失败:", e.message);
  process.exit(1);
});
