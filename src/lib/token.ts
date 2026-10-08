import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC-SHA256 で署名した短いトークン。セッション（ログイン）と QR の両方に使う。
 *
 *   <base64url(JSON claims)>.<base64url(HMAC 先頭 20 バイト)>
 *
 * QR に載せるので短くする: キー名は 1 文字、exp は秒。
 * 署名は 160 bit に切り詰める（QR のバージョンを 1〜2 下げられる。偽造耐性は十分）。
 */

export type Role = 'student' | 'teacher'

export interface SessionClaims {
  k: 's'
  /** t = teacher / s = student */
  r: 't' | 's'
  /** subject: 学籍番号 または 先生の表示名 */
  s: string
  /** 有効期限（UNIX 秒） */
  e: number
}

export interface QrClaims {
  k: 'q'
  /** 学籍番号 */
  s: string
  e: number
}

export type Claims = SessionClaims | QrClaims

export type VerifyResult<T extends Claims = Claims> =
  | { ok: true; claims: T }
  | { ok: false; reason: 'invalid' | 'expired' }

const SIG_BYTES = 20

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function hmac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest().subarray(0, SIG_BYTES)
}

export function signToken(claims: Claims, secret: string): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'))
  return `${payload}.${b64url(hmac(payload, secret))}`
}

function isClaims(v: unknown): v is Claims {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o['s'] !== 'string' || typeof o['e'] !== 'number') return false
  if (o['k'] === 'q') return true
  if (o['k'] === 's') return o['r'] === 't' || o['r'] === 's'
  return false
}

export function verifyToken(token: string, secret: string, nowMs = Date.now()): VerifyResult {
  const dot = token.indexOf('.')
  if (dot <= 0 || token.length > 1024) return { ok: false, reason: 'invalid' }
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  let given: Buffer
  try {
    given = Buffer.from(sig, 'base64url')
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const expected = hmac(payload, secret)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!isClaims(parsed)) return { ok: false, reason: 'invalid' }
  if (parsed.e * 1000 <= nowMs) return { ok: false, reason: 'expired' }
  return { ok: true, claims: parsed }
}

export function roleOf(claims: SessionClaims): Role {
  return claims.r === 't' ? 'teacher' : 'student'
}

export function expiresIn(seconds: number, nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000) + seconds
}
