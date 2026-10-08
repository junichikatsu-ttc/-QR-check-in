import { z } from 'zod'

/**
 * API 契約。サーバの入力検証に使い、フロントの JSDoc からも参照できるよう 1 箇所にまとめる。
 * ブランド型（TenantId / StudentId / EventId）は parse でしか作れないので、
 * 文字列連結でデータストアのキーを作るコードはコンパイルを通らない。
 */

// ---- ID -----------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/

/** テナント（学校）。全テーブルのメインキーの先頭に入る */
export const tenantIdSchema = z.string().regex(ID_RE).brand<'TenantId'>()
export type TenantId = z.infer<typeof tenantIdSchema>

/** 学籍番号 */
export const studentIdSchema = z
  .string()
  .trim()
  .regex(ID_RE, '学籍番号は英数字・_・- の 1〜32 文字')
  .brand<'StudentId'>()
export type StudentId = z.infer<typeof studentIdSchema>

/** イベント ID。作成時刻（ms）を 10 進文字列にしたもの */
export const eventIdSchema = z.string().regex(/^\d{12,14}$/, 'eventId が不正').brand<'EventId'>()
export type EventId = z.infer<typeof eventIdSchema>

// ---- 名簿 ----------------------------------------------------------------

export const studentSchema = z.object({
  studentId: studentIdSchema,
  name: z.string().trim().min(1, '氏名は必須').max(64),
  className: z.string().trim().max(32).default(''),
})
export type Student = z.infer<typeof studentSchema>

export const ROSTER_MAX = 2000

export const putRosterSchema = z
  .object({
    students: z.array(studentSchema).min(1, '名簿が空です').max(ROSTER_MAX, `名簿は ${ROSTER_MAX} 人まで`),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>()
    v.students.forEach((s, i) => {
      if (seen.has(s.studentId)) {
        ctx.addIssue({ code: 'custom', path: ['students', i, 'studentId'], message: `学籍番号が重複: ${s.studentId}` })
      }
      seen.add(s.studentId)
    })
  })
export type PutRosterInput = z.infer<typeof putRosterSchema>

// ---- 認証 ----------------------------------------------------------------

export const studentLoginSchema = z.object({ studentId: studentIdSchema })
export const teacherLoginSchema = z.object({
  password: z.string().min(1, 'パスワードは必須').max(256),
  name: z.string().trim().max(32).default(''),
})

// ---- イベント --------------------------------------------------------------

export const createEventSchema = z.object({
  name: z.string().trim().min(1, 'イベント名は必須').max(64),
  /** 対象クラス。空なら名簿全員 */
  classNames: z.array(z.string().trim().min(1).max(32)).max(50).default([]),
})
export type CreateEventInput = z.infer<typeof createEventSchema>

export interface EventSummary {
  eventId: EventId
  name: string
  classNames: string[]
  createdAt: number
  createdBy: string
}

// ---- チェックイン ------------------------------------------------------------

export const checkinInputSchema = z
  .object({
    /** 生徒の画面に出ている QR の中身 */
    qr: z.string().min(10).max(512).optional(),
    /** 手動チェックイン（QR を出せない生徒向け） */
    studentId: studentIdSchema.optional(),
    /** 読み取り地点（バス番号など）。端末ごとに先生が設定する */
    point: z.string().trim().max(32).default(''),
  })
  .refine((v) => Boolean(v.qr) !== Boolean(v.studentId), { message: 'qr か studentId のどちらか一方を指定' })
export type CheckinInput = z.infer<typeof checkinInputSchema>

export type CheckinMethod = 'qr' | 'manual'

export interface Checkin {
  studentId: StudentId
  checkedInAt: number
  point: string
  method: CheckinMethod
  by: string
}

/** イベント詳細（先生の一覧画面）。集計はサーバで計算して返す */
export interface EventStatus {
  event: EventSummary
  students: Array<Student & { checkin?: Checkin }>
  /** 対象外（対象クラス以外・名簿に無い）のチェックイン */
  extra: Array<{ studentId: StudentId; name: string; className: string; checkin: Checkin }>
  summary: { total: number; checkedIn: number; remaining: number }
  rosterUpdatedAt: number | undefined
}

// ---- 運用 ----------------------------------------------------------------

export interface Health {
  status: 'ok'
  version: string
  commit: string
  builtAt: string
  basicAuth: boolean
  datastore: 'cloud' | 'memory'
  configOk: boolean
  configMissing: number
  limits: Record<string, number>
}
