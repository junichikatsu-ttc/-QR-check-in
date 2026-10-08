// @ts-check
import { describe, expect, it } from 'vitest'
import { parseRoster, toCsv } from '../web/src/csv.js'

describe('parseRoster', () => {
  it('タブ区切り（Excel の貼り付け）を読む', () => {
    const r = parseRoster('2024001\t山田 太郎\t1-A\n2024002\t鈴木 花子\t1-A\n')
    expect(r.students).toEqual([
      { studentId: '2024001', name: '山田 太郎', className: '1-A' },
      { studentId: '2024002', name: '鈴木 花子', className: '1-A' },
    ])
    expect(r.skippedHeader).toBe(false)
    expect(r.errors).toEqual([])
  })

  it('カンマ区切りと見出し行、クラス省略', () => {
    const r = parseRoster('学籍番号,氏名,クラス\r\n2024001,"山田, 太郎"\r\n')
    expect(r.skippedHeader).toBe(true)
    expect(r.students).toEqual([{ studentId: '2024001', name: '山田, 太郎', className: '' }])
  })

  it('不正な行は errors に入り、他の行は読む', () => {
    const r = parseRoster('2024001\t山田\n\t名前だけ\n2024003\t\n2024004\t佐藤\t1-B')
    expect(r.students.map((s) => s.studentId)).toEqual(['2024001', '2024004'])
    expect(r.errors).toHaveLength(2)
  })
})

describe('toCsv', () => {
  it('カンマ・引用符・改行をエスケープする', () => {
    expect(toCsv([['a', 'b,c', 'd"e'], ['1', '', 'x\ny']])).toBe('a,"b,c","d""e"\r\n1,,"x\ny"')
  })
})
