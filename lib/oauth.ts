// lib/oauth.ts — 知乎黑客松 OAuth 接入（服务端）
// 依据 skill: hackathon-oauth.md / oauth.md / hackathon-user-profile-api.md
// 安全：app_key 与 OAuth access_token 只留服务端；浏览器仅持 HttpOnly 会话 Cookie。
import crypto from "node:crypto";

const APP_ID = process.env.ZHIHU_OAUTH_APP_ID || "";
const APP_KEY = process.env.ZHIHU_OAUTH_APP_KEY || "";
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const REDIRECT_URI = process.env.ZHIHU_OAUTH_REDIRECT_URI
  || new URL("/api/auth/callback", APP_BASE_URL).toString();
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1"
  ? true
  : process.env.COOKIE_SECURE === "0"
    ? false
    : REDIRECT_URI.startsWith("https://");
// Mock 模式：无真实凭证时用于本地联调与 Demo（不访问真网）
export const oauthMock = () => process.env.ZHIHU_OAUTH_MOCK === "1" || !APP_ID || !APP_KEY;
export const oauthConfigured = () => Boolean(APP_ID && APP_KEY && REDIRECT_URI);

const AUTHORIZE_URL = "https://openapi.zhihu.com/authorize";
const TOKEN_URL = "https://openapi.zhihu.com/access_token";
const USER_URL = "https://openapi.zhihu.com/user";

export interface ZhihuUser {
  uid: string; // int64，须以字符串无损保存
  hashId: string;
  fullname: string;
  avatar: string;
  headline: string;
}
interface Session {
  sid: string;
  user: ZhihuUser;
  accessToken: string; // 仅服务端
  expiresAt: number;
}

// —— 进程内存储（常驻单进程 Demo 可用；多实例需换共享存储）——
const stateStore = new Map<string, number>(); // state -> 过期时间
const sessionStore = new Map<string, Session>(); // sid -> session
const STATE_TTL = 10 * 60 * 1000;

/** 生成并保存不可预测 state（绑定短时有效期） */
export function issueState(): string {
  const s = crypto.randomBytes(16).toString("hex");
  stateStore.set(s, Date.now() + STATE_TTL);
  return s;
}
/** 校验并原子消费 state（防重放） */
export function consumeState(s: string): boolean {
  if (!s) return false;
  const exp = stateStore.get(s);
  if (!exp) return false;
  stateStore.delete(s); // 原子消费
  return exp >= Date.now();
}

/** 构造授权 URL */
export function buildAuthorizeUrl(state: string): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("app_id", APP_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

/** 用授权码换 access_token（服务端） */
export async function exchangeToken(code: string): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams();
  body.set("app_id", APP_ID);
  body.set("app_key", APP_KEY);
  body.set("grant_type", "authorization_code");
  body.set("redirect_uri", REDIRECT_URI);
  body.set("code", code); // token 接口表单字段为 code（回调参数名为 authorization_code）
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const j = await res.json().catch(() => ({}));
  if (!j?.access_token) throw new Error(`TOKEN_EXCHANGE_FAILED: ${JSON.stringify(j).slice(0, 200)}`);
  return { accessToken: j.access_token, expiresIn: Number(j.expires_in || 3600) };
}

/** 拉取授权用户基础信息；uid 无损解析为字符串 */
export async function fetchUser(accessToken: string): Promise<ZhihuUser> {
  const res = await fetch(USER_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  // uid 可能超 JS 安全整数 → 先正则提取原始数字串，避免 JSON.parse 丢精度
  const uidMatch = text.match(/"uid"\s*:\s*(\d+)/);
  let j: any = {};
  try { j = JSON.parse(text); } catch { /* 部分字段容错 */ }
  // 依据文档：401=token 无效/缺失，403=权限不足，404=用户不存在；均为 HTTP 200 + 业务 code
  const code = Number(j?.code);
  if (!uidMatch && (code === 401 || code === 403 || code === 404)) {
    const msg = typeof j?.data === "string" ? j.data : `code ${code}`;
    throw new Error(`USER_FETCH_FAILED(${code}): ${msg}`);
  }
  // 成功可能为 code 20000/0 或直接带 uid；不把非零一律当失败
  const uid = uidMatch ? uidMatch[1] : String(j.uid || "");
  if (!uid) throw new Error(`USER_NO_UID: ${text.slice(0, 200)}`);
  return {
    uid,
    hashId: j.hash_id || "",
    fullname: j.fullname || "知乎用户",
    avatar: j.avatar_path || "",
    headline: j.headline || "",
  };
}

/** 建立应用会话，返回 sid */
export function createSession(user: ZhihuUser, accessToken: string, expiresIn: number): string {
  const sid = crypto.randomBytes(24).toString("hex");
  sessionStore.set(sid, { sid, user, accessToken, expiresAt: Date.now() + expiresIn * 1000 });
  return sid;
}
export function getSession(sid: string): Session | null {
  if (!sid) return null;
  const s = sessionStore.get(sid);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { sessionStore.delete(sid); return null; }
  return s;
}
export function destroySession(sid: string): void {
  if (sid) sessionStore.delete(sid);
}

export function sessionCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax" as const, maxAge, path: "/" };
}

// —— Mock：无凭证时模拟一个知乎用户，便于本地/Demo 演示登录闭环 ——
export function mockUser(): ZhihuUser {
  return {
    uid: "969570047710216200",
    hashId: "mock_hash",
    fullname: "刘看山（模拟登录）",
    avatar: "/kanshan/front.jpg",
    headline: "OAuth Mock · 配置真实 App ID/Key 后切换为真登录",
  };
}
