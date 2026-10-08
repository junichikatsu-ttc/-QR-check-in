import { Hono } from 'hono'
import { readConfig } from '../config'
import { findStudent } from '../datastore'
import { AppError, unauthorized } from '../errors'
import { expiresIn, roleOf, signToken } from '../lib/token'
import type { AuthVars } from '../middleware/auth'

/**
 * ログイン中の自分。
 *   GET /v1/me      生徒: 名簿上の自分 / 先生: 表示名
 *   GET /v1/me/qr   生徒のみ。短命の QR トークン（データストアには当たらない）
 */
export function meRoutes(): Hono<AuthVars> {
  const r = new Hono<AuthVars>()

  r.get('/', async (c) => {
    const auth = c.get('auth')
    const cfg = readConfig()
    if (roleOf(auth) === 'teacher') return c.json({ role: 'teacher', teacher: { name: auth.s } })
    const student = await findStudent(cfg.tenantId, auth.s)
    // ログイン後に名簿から外された場合。トークンは有効でも本人確認できないので弾く
    if (!student) throw unauthorized('名簿にありません。先生に確認してください')
    return c.json({ role: 'student', student })
  })

  r.get('/qr', (c) => {
    const auth = c.get('auth')
    if (roleOf(auth) !== 'student') throw new AppError('FORBIDDEN', 403, 'QR は生徒のみ')
    const cfg = readConfig()
    if (!cfg.sessionSecret) throw new AppError('CONFIG_MISSING', 500, 'SESSION_SECRET is not configured')
    const exp = expiresIn(cfg.qrTtlSec)
    const qr = signToken({ k: 'q', s: auth.s, e: exp }, cfg.sessionSecret)
    return c.json({ qr, expiresAt: exp * 1000, ttlSec: cfg.qrTtlSec })
  })

  return r
}
