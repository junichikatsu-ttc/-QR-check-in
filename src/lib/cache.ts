/**
 * 実行コンテナ内の短命キャッシュ。名簿とイベントのように「毎スキャンで読むが滅多に変わらない」
 * アイテムの getItem を減らし、データストアのアクセス数上限（constraints.md E4）を守る。
 *
 * - コンテナごとに独立。別コンテナの更新は TTL が切れるまで見えない（名簿更新後 最大 30 秒）
 * - テストは beforeEach で clearCache() する（fake データストアを入れ替えても残るため）
 */

interface Entry {
  exp: number
  value: unknown
}

const store = new Map<string, Entry>()

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  const now = Date.now()
  if (hit && hit.exp > now) return hit.value as T
  const value = await fn()
  store.set(key, { exp: now + ttlMs, value })
  return value
}

export function invalidate(key: string): void {
  store.delete(key)
}

export function clearCache(): void {
  store.clear()
}
