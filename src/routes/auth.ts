import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { readConfig } from '../config'
import { findStudent } from '../datastore'
import { AppError, unauthorized } from '../errors'
import { expiresIn, signToken } from '../lib/token'
import { studentLoginSchema, teacherLoginSchema } from '../schemas'

/**
 * 認証不要のエンドポイント（routes/index.ts で除外されている）。
 *   POST /v1/auth/student  { studentId }        名簿に居る学籍番号ならログイン
 *   POST /v1/auth/teacher  { password, name? }  TEACHER_PASSWORD と一致すればログイン
 */

function secretOrThrow(): string {
  const s = readConfig().sessionSecret
  if (!s) throw new AppError('CONFIG_MISSING', 500, 'SESSION_SECRET is not configured')
  return s
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function authRoutes(): Hono {
  const r = new Hono()

  r.post('/student', async (c) => {
    const { studentId } = studentLoginSchema.parse(await c.req.json())
    const cfg = readConfig()
    const secret = secretOrThrow()
    const student = await findStudent(cfg.tenantId, studentId)
    // 名簿に無い学籍番号はログインさせない（名簿が空なら先生が先に登録する）
    if (!student) throw unauthorized('この学籍番号は名簿にありません')
    const token = signToken({ k: 's', r: 's', s: student.studentId, e: expiresIn(cfg.sessionTtlHours * 3600) }, secret)
    return c.json({ token, student })
  })

  r.post('/teacher', async (c) => {
    const input = teacherLoginSchema.parse(await c.req.json())
    const cfg = readConfig()
    const secret = secretOrThrow()
    if (!cfg.teacherPassword) throw new AppError('CONFIG_MISSING', 500, 'TEACHER_PASSWORD is not configured')
    if (!safeEqual(input.password, cfg.teacherPassword)) throw unauthorized('パスワードが違います')
    const name = input.name || '先生'
    const token = signToken({ k: 's', r: 't', s: name, e: expiresIn(cfg.sessionTtlHours * 3600) }, secret)
    return c.json({ token, teacher: { name } })
  })

  return r
}
