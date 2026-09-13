// lib/cache.ts — 进程内存缓存 + 清单（AiWorks 部署：无数据库写入）
// 原 SQLite 版已移除，改为进程内 Map，保持对外 API 签名不变。
// 注意：进程内存储在多实例/重启后不持久；缓存本就是加速用途，清单主存储改由前端 localStorage 承担。

interface CacheEntry {
  value: string;
  expiresAt: number;
}
const cacheMap = new Map<string, CacheEntry>();

/** 读缓存（未过期才返回） */
export function cacheGet<T = any>(key: string): T | null {
  const row = cacheMap.get(key);
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    cacheMap.delete(key);
    return null;
  }
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

/** 写缓存（ttlMs 默认 10 分钟；配额敏感项应传更长） */
export function cacheSet(key: string, value: unknown, ttlMs = 10 * 60 * 1000): void {
  cacheMap.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlMs });
  // 轻量清理：偶发清除过期项，避免内存无限增长
  if (cacheMap.size > 500) {
    const now = Date.now();
    for (const [k, v] of cacheMap) if (v.expiresAt < now) cacheMap.delete(k);
  }
}

/** 便捷：缓存包装器 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>
): Promise<{ value: T; cached: boolean }> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return { value: hit, cached: true };
  const value = await producer();
  cacheSet(key, value, ttlMs);
  return { value, cached: false };
}

// —— 我的清单：进程内存兜底（主存储在前端 localStorage）——
// 保留服务端接口以兼容旧调用；进程重启会清空，正式清单以前端本地为准。
interface ListRow {
  id: string;
  user_local_id: string;
  zhihu_user_id?: string;
  kind: string;
  payload: any;
  created_at: number;
}
const listStore: ListRow[] = [];

export function listAdd(userLocalId: string, kind: "evolution" | "followup", payload: unknown): string {
  const id = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  listStore.unshift({ id, user_local_id: userLocalId, kind, payload, created_at: Date.now() });
  return id;
}

export function listGet(userLocalId: string, kind?: "evolution" | "followup") {
  return listStore.filter((r) => r.user_local_id === userLocalId && (!kind || r.kind === kind));
}

export function listDelete(userLocalId: string, id: string): boolean {
  const i = listStore.findIndex((r) => r.id === id && r.user_local_id === userLocalId);
  if (i < 0) return false;
  listStore.splice(i, 1);
  return true;
}
