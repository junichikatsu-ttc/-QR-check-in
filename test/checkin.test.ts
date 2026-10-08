import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryDataStoreClient, runGet, setDataStoreClient, setTableIdResolver } from '../src/datastore'
import { clearCache } from '../src/lib/cache'
import { signToken } from '../src/lib/token'

/**
 * 主要導線の統合テスト。データストアだけを fake に差し替え、それ以外は本物を通す。
 * データストアはローカルで代替できないので、通しの確認はこの 1 本で行う。
 *
 *   先生ログイン → 名簿登録 → イベント作成 → 生徒ログイン → QR 取得 → 先生がスキャン → 一覧で済みになる
 */

const app = createApp()
let store: MemoryDataStoreClient

const SECRET = 'test-secret'
const BASE = '/myapp'

beforeEach(() => {
  process.env['SESSION_SECRET'] = SECRET
  process.env['TEACHER_PASSWORD'] = 'pw'
  process.env['QR_TTL_SEC'] = '300'
  store = new MemoryDataStoreClient()
  setDataStoreClient(store, 'memory')
  setTableIdResolver((name) => name)
  clearCache()
})

afterEach(() => {
  setDataStoreClient(undefined)
  setTableIdResolver(undefined)
  clearCache()
  delete process.env['SESSION_SECRET']
  delete process.env['TEACHER_PASSWORD']
  delete process.env['QR_TTL_SEC']
})

async function call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (init.token) headers['authorization'] = `Bearer ${init.token}`
  const req: RequestInit = { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers }
  if (init.body !== undefined) req.body = JSON.stringify(init.body)
  const res = await app.request(`${BASE}${path}`, req)
  const text = await res.text()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = text ? JSON.parse(text) : null
  return { status: res.status, json }
}

const ROSTER = [
  { studentId: '2024001', name: '山田 太郎', className: '1-A' },
  { studentId: '2024002', name: '鈴木 花子', className: '1-A' },
  { studentId: '2024101', name: '佐藤 次郎', className: '1-B' },
]

async function teacherLogin(): Promise<string> {
  const res = await call('/v1/auth/teacher', { body: { password: 'pw', name: '担任' } })
  expect(res.status).toBe(200)
  return res.json.token as string
}

async function setup() {
  const teacher = await teacherLogin()
  expect((await call('/v1/roster', { method: 'PUT', token: teacher, body: { students: ROSTER } })).status).toBe(200)
  const ev = await call('/v1/events', { token: teacher, body: { name: '帰りのバス', classNames: ['1-A'] } })
  expect(ev.status).toBe(201)
  return { teacher, eventId: ev.json.event.eventId as string }
}

describe('認証', () => {
  it('先生: パスワード違いは 401、正しければトークンが返る', async () => {
    expect((await call('/v1/auth/teacher', { body: { password: 'wrong' } })).status).toBe(401)
    expect((await call('/v1/auth/teacher', { body: { password: 'pw' } })).status).toBe(200)
  })

  it('生徒: 名簿に無い学籍番号は 401、あれば氏名付きでトークンが返る', async () => {
    await setup()
    expect((await call('/v1/auth/student', { body: { studentId: '9999999' } })).status).toBe(401)
    const ok = await call('/v1/auth/student', { body: { studentId: '2024001' } })
    expect(ok.status).toBe(200)
    expect(ok.json.student.name).toBe('山田 太郎')
  })

  it('先生専用 API は生徒トークンでは 403、無しでは 401', async () => {
    await setup()
    const student = (await call('/v1/auth/student', { body: { studentId: '2024001' } })).json.token
    expect((await call('/v1/events', { token: student })).status).toBe(403)
    expect((await call('/v1/events')).status).toBe(401)
    expect((await call('/v1/roster')).status).toBe(401)
  })

  it('SESSION_SECRET が無くても /v1/health は返り、認証 API は CONFIG_MISSING になる', async () => {
    delete process.env['SESSION_SECRET']
    const health = await call('/v1/health')
    expect(health.status).toBe(200)
    expect(health.json.configOk).toBe(false)
    const res = await call('/v1/auth/teacher', { body: { password: 'pw' } })
    expect(res.status).toBe(500)
    expect(res.json.error.code).toBe('CONFIG_MISSING')
  })
})

describe('チェックイン導線', () => {
  it('生徒の QR を先生がスキャンすると一覧で済みになる', async () => {
    const { teacher, eventId } = await setup()

    const studentToken = (await call('/v1/auth/student', { body: { studentId: '2024001' } })).json.token
    const qr = await call('/v1/me/qr', { token: studentToken })
    expect(qr.status).toBe(200)
    expect(qr.json.qr.length).toBeLessThan(160) // QR のバージョンを抑えるため短く保つ

    const scanned = await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { qr: qr.json.qr, point: 'バス1' } })
    expect(scanned.status).toBe(201)
    expect(scanned.json.already).toBe(false)
    expect(scanned.json.inTarget).toBe(true)
    expect(scanned.json.student.name).toBe('山田 太郎')
    expect(scanned.json.checkin.point).toBe('バス1')
    expect(scanned.json.checkin.by).toBe('担任')

    // 2 回目は already: true（新しいアイテムは増えない）
    const again = await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { qr: qr.json.qr } })
    expect(again.status).toBe(200)
    expect(again.json.already).toBe(true)

    const status = await call(`/v1/events/${eventId}`, { token: teacher })
    expect(status.status).toBe(200)
    expect(status.json.summary).toEqual({ total: 2, checkedIn: 1, remaining: 1 })
    const yamada = status.json.students.find((s: { studentId: string }) => s.studentId === '2024001')
    expect(yamada.checkin.method).toBe('qr')
    expect(status.json.students.find((s: { studentId: string }) => s.studentId === '2024101')).toBeUndefined()
    expect(store.dump('checkins')).toHaveLength(1)
  })

  it('手動チェックインは名簿に無い学籍番号を 404 で弾く', async () => {
    const { teacher, eventId } = await setup()
    expect((await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { studentId: '0000000' } })).status).toBe(404)
    const ok = await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { studentId: '2024002' } })
    expect(ok.status).toBe(201)
    expect(ok.json.checkin.method).toBe('manual')
  })

  it('対象クラス外の生徒は記録されるが inTarget: false で、一覧では extra に出る', async () => {
    const { teacher, eventId } = await setup()
    const res = await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { studentId: '2024101' } })
    expect(res.status).toBe(201)
    expect(res.json.inTarget).toBe(false)
    const status = await call(`/v1/events/${eventId}`, { token: teacher })
    expect(status.json.summary.checkedIn).toBe(0)
    expect(status.json.extra).toHaveLength(1)
    expect(status.json.extra[0].name).toBe('佐藤 次郎')
  })

  it('期限切れ QR は QR_EXPIRED、他アプリの文字列は QR_INVALID、セッショントークンを QR にしても弾く', async () => {
    const { teacher, eventId } = await setup()
    const expired = signToken({ k: 'q', s: '2024001', e: Math.floor(Date.now() / 1000) - 1 }, SECRET)
    const r1 = await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { qr: expired } })
    expect(r1.json.error.code).toBe('QR_EXPIRED')

    const r2 = await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { qr: 'https://example.com/x' } })
    expect(r2.json.error.code).toBe('QR_INVALID')

    const session = signToken({ k: 's', r: 's', s: '2024001', e: Math.floor(Date.now() / 1000) + 60 }, SECRET)
    const r3 = await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { qr: session } })
    expect(r3.json.error.code).toBe('QR_INVALID')
  })

  it('取り消すと未に戻る', async () => {
    const { teacher, eventId } = await setup()
    await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { studentId: '2024001' } })
    expect((await call(`/v1/events/${eventId}/checkins/2024001`, { method: 'DELETE', token: teacher })).status).toBe(204)
    expect((await call(`/v1/events/${eventId}/checkins/2024001`, { method: 'DELETE', token: teacher })).status).toBe(404)
    const status = await call(`/v1/events/${eventId}`, { token: teacher })
    expect(status.json.summary.checkedIn).toBe(0)
  })

  it('スキャン 1 回のデータストアアクセスは getItem 1 + putItem 1（名簿・イベントはキャッシュ）', async () => {
    const { teacher, eventId } = await setup()
    // 1 回目でキャッシュを温める
    await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { studentId: '2024001' } })
    const before = { ...store.calls }
    await call(`/v1/events/${eventId}/checkins`, { token: teacher, body: { studentId: '2024002' } })
    expect(store.calls.getItem - before.getItem).toBe(1)
    expect(store.calls.putItem - before.putItem).toBe(1)
    expect(store.calls.query - before.query).toBe(0)
  })
})

describe('名簿', () => {
  it('学籍番号の重複は VALIDATION', async () => {
    const teacher = await teacherLogin()
    const res = await call('/v1/roster', {
      method: 'PUT',
      token: teacher,
      body: { students: [ROSTER[0], ROSTER[0]] },
    })
    expect(res.status).toBe(400)
    expect(res.json.error.code).toBe('VALIDATION')
  })

  it('名簿を置き換えるとキャッシュが無効化され、直後のログインに反映される', async () => {
    const { teacher } = await setup()
    expect((await call('/v1/auth/student', { body: { studentId: '2024999' } })).status).toBe(401)
    await call('/v1/roster', {
      method: 'PUT',
      token: teacher,
      body: { students: [...ROSTER, { studentId: '2024999', name: '転入 生', className: '1-A' }] },
    })
    expect((await call('/v1/auth/student', { body: { studentId: '2024999' } })).status).toBe(200)
  })
})

describe('イベント', () => {
  it('新しい順に並び、削除できる', async () => {
    const teacher = await teacherLogin()
    const a = await call('/v1/events', { token: teacher, body: { name: '行き' } })
    await new Promise((r) => setTimeout(r, 2))
    const b = await call('/v1/events', { token: teacher, body: { name: '帰り' } })
    const list = await call('/v1/events', { token: teacher })
    expect(list.json.events.map((e: { name: string }) => e.name)).toEqual(['帰り', '行き'])
    expect((await call(`/v1/events/${a.json.event.eventId}`, { method: 'DELETE', token: teacher })).status).toBe(204)
    expect((await call(`/v1/events/${a.json.event.eventId}`, { token: teacher })).status).toBe(404)
    expect((await call(`/v1/events/${b.json.event.eventId}`, { token: teacher })).status).toBe(200)
  })
})

describe('getItem の "Not found"（pitfalls 6）', () => {
  it('正常系として undefined に落ちる（503 にしない）', async () => {
    // ここを 503 にすると「初回は必ず無い」名簿・未チェックインの導線が原理的に成立しない
    const res = await runGet(() => store.getItem({ tableId: 'roster', key: { tenantId: 'default', key: 'roster' } }))
    expect(res).toBeUndefined()
  })
})
