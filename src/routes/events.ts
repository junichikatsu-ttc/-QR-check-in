import { Hono } from 'hono'
import { readConfig } from '../config'
import {
  createEvent,
  deleteCheckin,
  deleteEvent,
  findStudent,
  getCheckin,
  getEvent,
  getRoster,
  listCheckins,
  listEvents,
  putCheckin,
  toEventKey,
  toSummary,
} from '../datastore'
import type { CheckinRecord, EventRecord } from '../datastore'
import { AppError, notFound } from '../errors'
import { verifyToken } from '../lib/token'
import type { AuthVars } from '../middleware/auth'
import { checkinInputSchema, createEventSchema, eventIdSchema, studentIdSchema } from '../schemas'
import type { Checkin, EventId, EventStatus, Student, StudentId, TenantId } from '../schemas'

/**
 * イベントとチェックイン（先生のみ。routes/index.ts で requireAuth('teacher') が掛かる）。
 *
 *   GET    /v1/events                            新しい順
 *   POST   /v1/events        { name, classNames } 作成
 *   GET    /v1/events/:eventId                   詳細 + 誰が済み/未か（集計込み）
 *   DELETE /v1/events/:eventId                   イベントを消す（チェックインは残るが参照されない）
 *   POST   /v1/events/:eventId/checkins  { qr | studentId, point }
 *   DELETE /v1/events/:eventId/checkins/:studentId   取り消し
 *
 * データストアのアクセス数（E4）の目安:
 *   スキャン 1 回 = getItem(checkin) 1 + putItem 1（名簿・イベントはコンテナ内キャッシュ）
 *   一覧 1 回     = query ceil(人数/100) 回（+ キャッシュ切れ時に getItem 2）
 */

async function eventOrThrow(tenantId: TenantId, eventId: EventId): Promise<EventRecord> {
  const ev = await getEvent(tenantId, eventId)
  if (!ev) throw notFound('event')
  return ev
}

function parseEventId(raw: string): EventId {
  const p = eventIdSchema.safeParse(raw)
  if (!p.success) throw notFound('event')
  return p.data
}

/** 対象クラスが指定されていれば絞る。空なら名簿全員 */
function targetStudents(roster: Student[], classNames: string[]): Student[] {
  if (classNames.length === 0) return roster
  const set = new Set(classNames)
  return roster.filter((s) => set.has(s.className))
}

function stripKey(rec: CheckinRecord): Checkin {
  return { studentId: rec.studentId, checkedInAt: rec.checkedInAt, point: rec.point, method: rec.method, by: rec.by }
}

export function eventRoutes(): Hono<AuthVars> {
  const r = new Hono<AuthVars>()

  r.get('/', async (c) => {
    const cfg = readConfig()
    const events = await listEvents(cfg.tenantId, cfg.eventListLimit)
    return c.json({ events: events.map(toSummary) })
  })

  r.post('/', async (c) => {
    const input = createEventSchema.parse(await c.req.json())
    const cfg = readConfig()
    const ev = await createEvent(cfg.tenantId, { ...input, createdBy: c.get('auth').s })
    return c.json({ event: toSummary(ev) }, 201)
  })

  r.get('/:eventId', async (c) => {
    const cfg = readConfig()
    const eventId = parseEventId(c.req.param('eventId'))
    const ev = await eventOrThrow(cfg.tenantId, eventId)
    const roster = await getRoster(cfg.tenantId)
    const checkins = await listCheckins(toEventKey(cfg.tenantId, eventId))

    const byStudent = new Map<string, CheckinRecord>(checkins.map((ck) => [ck.studentId, ck]))
    const allStudents = roster?.students ?? []
    const targets = targetStudents(allStudents, ev.classNames)
    const targetIds = new Set(targets.map((s) => s.studentId))

    const students: EventStatus['students'] = targets.map((s) => {
      const ck = byStudent.get(s.studentId)
      return ck ? { ...s, checkin: stripKey(ck) } : { ...s }
    })
    const extra: EventStatus['extra'] = checkins
      .filter((ck) => !targetIds.has(ck.studentId))
      .map((ck) => {
        const s = allStudents.find((x) => x.studentId === ck.studentId)
        return { studentId: ck.studentId, name: s?.name ?? '', className: s?.className ?? '', checkin: stripKey(ck) }
      })
    const checkedIn = students.filter((s) => s.checkin).length
    const body: EventStatus = {
      event: toSummary(ev),
      students,
      extra,
      summary: { total: students.length, checkedIn, remaining: students.length - checkedIn },
      rosterUpdatedAt: roster?.updatedAt,
    }
    return c.json(body)
  })

  r.delete('/:eventId', async (c) => {
    const cfg = readConfig()
    const eventId = parseEventId(c.req.param('eventId'))
    await eventOrThrow(cfg.tenantId, eventId)
    await deleteEvent(cfg.tenantId, eventId)
    return c.body(null, 204)
  })

  r.post('/:eventId/checkins', async (c) => {
    const cfg = readConfig()
    const eventId = parseEventId(c.req.param('eventId'))
    const input = checkinInputSchema.parse(await c.req.json())
    const ev = await eventOrThrow(cfg.tenantId, eventId)

    let studentId: StudentId
    let method: Checkin['method']
    if (input.qr !== undefined) {
      if (!cfg.sessionSecret) throw new AppError('CONFIG_MISSING', 500, 'SESSION_SECRET is not configured')
      const v = verifyToken(input.qr, cfg.sessionSecret)
      if (!v.ok) {
        if (v.reason === 'expired') throw new AppError('QR_EXPIRED', 400, 'QR の有効期限切れです。生徒の画面を更新してもらってください')
        throw new AppError('QR_INVALID', 400, 'このアプリの QR ではありません')
      }
      if (v.claims.k !== 'q') throw new AppError('QR_INVALID', 400, 'このアプリの QR ではありません')
      const sid = studentIdSchema.safeParse(v.claims.s)
      if (!sid.success) throw new AppError('QR_INVALID', 400, 'このアプリの QR ではありません')
      studentId = sid.data
      method = 'qr'
    } else {
      studentId = input.studentId!
      method = 'manual'
    }

    const student = await findStudent(cfg.tenantId, studentId)
    // 手動入力は打ち間違いを弾く。QR は署名済み（ログイン時に名簿に居た）なので名簿から消えていても記録する
    if (!student && method === 'manual') throw notFound('student')

    const eventKey = toEventKey(cfg.tenantId, eventId)
    const inTarget = student ? targetStudents([student], ev.classNames).length === 1 : false
    const existing = await getCheckin(eventKey, studentId)
    if (existing) {
      return c.json({ already: true, checkin: stripKey(existing), student: student ?? null, inTarget })
    }
    const saved = await putCheckin(eventKey, {
      studentId,
      checkedInAt: Date.now(),
      point: input.point,
      method,
      by: c.get('auth').s,
    })
    return c.json({ already: false, checkin: stripKey(saved), student: student ?? null, inTarget }, 201)
  })

  r.delete('/:eventId/checkins/:studentId', async (c) => {
    const cfg = readConfig()
    const eventId = parseEventId(c.req.param('eventId'))
    const sid = studentIdSchema.safeParse(c.req.param('studentId'))
    if (!sid.success) throw notFound('checkin')
    const eventKey = toEventKey(cfg.tenantId, eventId)
    if (!(await getCheckin(eventKey, sid.data))) throw notFound('checkin')
    await deleteCheckin(eventKey, sid.data)
    return c.body(null, 204)
  })

  return r
}
