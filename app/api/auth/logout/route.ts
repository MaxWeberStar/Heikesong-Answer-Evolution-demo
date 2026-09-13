// app/api/auth/logout/route.ts — 退出登录：销毁会话
import { NextRequest, NextResponse } from "next/server";
import { getSession, destroySession } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sid = req.cookies.get("ae_sid")?.value || "";
  const s = getSession(sid);
  if (s) destroySession(sid);
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ae_sid", "", { maxAge: 0, path: "/" });
  return res;
}
