import { describe, expect, it } from 'vitest'
import { expiresIn, signToken, verifyToken } from '../src/lib/token'

const SECRET = 's3cret'

describe('token', () => {
  it('署名して検証できる', () => {
    const t = signToken({ k: 'q', s: '2024001', e: expiresIn(60) }, SECRET)
    const v = verifyToken(t, SECRET)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.claims.s).toBe('2024001')
  })

  it('鍵が違えば invalid', () => {
    const t = signToken({ k: 'q', s: '2024001', e: expiresIn(60) }, SECRET)
    expect(verifyToken(t, 'other')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('本文を書き換えると invalid（署名が合わない）', () => {
    const t = signToken({ k: 'q', s: '2024001', e: expiresIn(60) }, SECRET)
    const forged = signToken({ k: 'q', s: '2024002', e: expiresIn(60) }, 'guess').split('.')[0] + '.' + t.split('.')[1]
    expect(verifyToken(forged, SECRET).ok).toBe(false)
  })

  it('期限切れは expired', () => {
    const t = signToken({ k: 'q', s: '2024001', e: expiresIn(-1) }, SECRET)
    expect(verifyToken(t, SECRET)).toEqual({ ok: false, reason: 'expired' })
  })

  it('壊れた入力で throw しない', () => {
    for (const bad of ['', '.', 'abc', 'a.b', '%%%.%%%', 'eyJ9.x']) {
      expect(verifyToken(bad, SECRET).ok).toBe(false)
    }
  })

  it('QR 用トークンは短い（QR のバージョンを抑える）', () => {
    const t = signToken({ k: 'q', s: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', e: expiresIn(300) }, SECRET)
    expect(t.length).toBeLessThan(120)
  })
})
