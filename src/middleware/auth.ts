import type { MiddlewareHandler } from 'hono'
import { readConfig } from '../config'
import { AppError, forbidden, unauthorized } from '../errors'
import { roleOf, verifyToken } from '../lib/token'
import type { Role, SessionClaims } from '../lib/token'

/**
 * `authorization: Bearer <token>` を検証して c.get('auth') に載せる。
 * 適用はルートファイル側に書かず、src/routes/index.ts でパス指定してまとめて掛ける。
 */

export type AuthVars = { Variables: { auth: SessionClaims } }

export function requireAuth(role?: Role): MiddlewareHandler<AuthVars> {
  return async (c, next) => {
    const secret = readConfig().sessionSecret
    if (!secret) throw new AppError('CONFIG_MISSING', 500, 'SESSION_SECRET is not configured')

    const m = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')
    const result = m ? verifyToken(m[1]!, secret) : undefined
    if (!result?.ok || result.claims.k !== 's') {
      throw unauthorized(result && !result.ok && result.reason === 'expired' ? 'ログインの有効期限が切れました' : 'ログインが必要です')
    }
    if (role && roleOf(result.claims) !== role) throw forbidden('この操作は先生のみ')
    c.set('auth', result.claims)
    await next()
  }
}
