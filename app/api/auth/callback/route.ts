// app/api/auth/callback/route.ts — 知乎 OAuth 回调：校验 state → 换 token → 拉用户 → 建会话
import { NextRequest, NextResponse } from "next/server";
import { consumeState, exchangeToken, fetchUser, createSession } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // 回调参数名以 authorization_code 为主，兼容 code
  const code = sp.get("authorization_code") || sp.get("code") || "";
  const state = sp.get("state") || "";
  const base = process.env.APP_BASE_URL || req.nextUrl.origin;

  // 双重 state 校验：内存 + Cookie
  const cookieState = req.cookies.get("ae_oauth_state")?.value || "";
  if (!code) return fail(base, "缺少授权码");
  if (!state || state !== cookieState || !consumeState(state)) {
    return fail(base, "state 校验失败（可能超时或重复回调），请重新登录");
  }

  try {
    const { accessToken, expiresIn } = await exchangeToken(code);
    const user = await fetchUser(accessToken);
    const sid = createSession(user, accessToken, expiresIn);
    const res = NextResponse.redirect(new URL("/", base));
    res.cookies.set("ae_sid", sid, { httpOnly: true, secure: true, sameSite: "lax", maxAge: expiresIn, path: "/" });
    // 清理临时 state cookie
    res.cookies.set("ae_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e) {
    return fail(base, "登录失败：" + (e as Error).message);
  }
}

function fail(base: string, msg: string) {
  const u = new URL("/", base);
  u.searchParams.set("login_error", msg);
  return NextResponse.redirect(u);
}
