import { Hono } from 'hono'
import { basicAuthGuard } from '../middleware/basic-auth'
import { sendAsset } from '../static'

/**
 * 静的ファイルの同一オリジン配信。
 *   /            生徒の画面（index.html）
 *   /teacher.html 先生の画面（/teacher でも開ける）
 * ★ 画面を増やすときは src/static.ts の STATIC_ASSET_NAMES と build.mjs の STATIC_ASSETS にも足す。
 *   HTML は必ず同じ階層（/foo.html）に置く。相対パスの CSS / JS がトリガーのパス配下に解決される。
 */
export function staticRoutes(): Hono {
  const r = new Hono()
  const guard = basicAuthGuard()

  r.get('/', guard, (c) => {
    const path = c.req.path
    // /myapp → /myapp/ にしないと href="styles.css" がトリガーの外（/styles.css）に解決される（pitfalls 3）
    if (!path.endsWith('/')) return c.redirect(`${path}/`, 302)
    return sendAsset(c, 'index.html')
  })
  r.get('/index.html', guard, (c) => sendAsset(c, 'index.html'))
  r.get('/teacher', (c) => c.redirect(`${c.req.path}.html`, 302))
  r.get('/teacher.html', guard, (c) => sendAsset(c, 'teacher.html'))

  // CSS / JS には掛けない（HTML から辿るため）
  r.get('/styles.css', (c) => sendAsset(c, 'styles.css'))
  r.get('/app.js', (c) => sendAsset(c, 'app.js'))
  r.get('/teacher.js', (c) => sendAsset(c, 'teacher.js'))

  return r
}
