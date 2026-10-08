import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import { authRoutes } from './auth'
import { eventRoutes } from './events'
import { healthHandler } from './health'
import { meRoutes } from './me'
import { rosterRoutes } from './roster'
import { staticRoutes } from './static-routes'

/**
 * ルート定義の 1 セット。app.ts が `/`・`/:base`・`/:base/` の 3 通りにマウントする。
 *
 * 認証は各ルートファイルに書かず、ここでパス指定してまとめて適用する。
 * 各ルートに書く方式はルート追加時に書き忘れる。忘れられる防御は防御ではない。
 *
 *   認証不要: /v1/health, /v1/auth/*, 静的ファイル
 *   ログイン: /v1/me, /v1/me/*
 *   先生のみ: /v1/roster, /v1/events, /v1/events/*
 */
export function createRoutes(): Hono {
  const routes = new Hono()

  routes.get('/v1/health', healthHandler)
  routes.route('/', staticRoutes())
  routes.route('/v1/auth', authRoutes())

  routes.use('/v1/me', requireAuth())
  routes.use('/v1/me/*', requireAuth())
  routes.route('/v1/me', meRoutes())

  routes.use('/v1/roster', requireAuth('teacher'))
  routes.route('/v1/roster', rosterRoutes())

  routes.use('/v1/events', requireAuth('teacher'))
  routes.use('/v1/events/*', requireAuth('teacher'))
  routes.route('/v1/events', eventRoutes())

  return routes
}
