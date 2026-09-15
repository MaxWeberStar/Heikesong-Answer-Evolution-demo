// app/api/auth/login/route.ts — 发起知乎 OAuth 授权
import { NextResponse } from "next/server";
import { issueState, buildAuthorizeUrl, oauthMock, createSession, mockUser, sessionCookieOptions } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Mock 模式：直接建立模拟会话并回首页（无真实凭证时用于 Demo）
  if (oauthMock()) {
    const sid = createSession(mockUser(), "mock_token", 3600);
    const res = NextResponse.redirect(new URL("/", process.env.APP_BASE_URL || "http://localhost:3000"));
    setSidCookie(res, sid);
    return res;
  }
  const state = issueState();
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url);
  // 把 state 也存 Cookie 以便回调时双重校验（HttpOnly）
  res.cookies.set("ae_oauth_state", state, sessionCookieOptions(600));
  return res;
}

function setSidCookie(res: NextResponse, sid: string) {
  res.cookies.set("ae_sid", sid, sessionCookieOptions(3600));
}
