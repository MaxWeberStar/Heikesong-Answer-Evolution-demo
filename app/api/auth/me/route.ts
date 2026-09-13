// app/api/auth/me/route.ts — 返回当前登录用户（仅公开字段，不含 token）
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sid = req.cookies.get("ae_sid")?.value || "";
  const s = getSession(sid);
  if (!s) return NextResponse.json({ user: null });
  // 只回公开字段，绝不回 accessToken
  return NextResponse.json({
    user: { uid: s.user.uid, hashId: s.user.hashId, fullname: s.user.fullname, avatar: s.user.avatar, headline: s.user.headline },
  });
}
