import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * フロントのソースに対するガード。eslint を入れていないので、ここで固定する。
 *   - innerHTML / outerHTML / insertAdjacentHTML を使わない（pitfalls 11。自動エスケープが無い）
 *   - HTML から参照している CSS / JS に ?v=__ASSET_VERSION__ が付いている（pitfalls 1）
 *   - JS が byId() で参照する id が HTML に存在する（無いと画面が白くなる）
 */

const webDir = join(__dirname, '..', 'web')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.js')) out.push(p)
  }
  return out
}

function codeLines(src: string): string[] {
  // 行コメントと JSDoc の説明行は除く（コメントで言及するのは構わない）
  return src.split('\n').filter((l) => {
    const t = l.trim()
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
  })
}

describe('フロントのガード', () => {
  it('innerHTML / outerHTML / insertAdjacentHTML を使っていない', () => {
    for (const file of walk(join(webDir, 'src'))) {
      const offending = codeLines(readFileSync(file, 'utf8')).filter((l) => /innerHTML|outerHTML|insertAdjacentHTML/.test(l))
      expect(offending, file).toEqual([])
    }
  })

  it('行頭が "(" や "/** @type */ (" で始まるコード行が無い（ASI で前の行とつながる）', () => {
    // 実例: `x.hidden = true` の次の行が `/** @type {X} */ (byId('p')).value = v` だと
    // `true(byId('p'))` と解釈され、TypeError: true is not a function で画面が止まる
    for (const file of walk(join(webDir, 'src'))) {
      const lines = codeLines(readFileSync(file, 'utf8')).filter((l) => l.trim() !== '')
      const offending = lines.filter((l, i) => {
        if (!/^\s*(\/\*\*[^*]*\*\/\s*)?\(/.test(l)) return false
        // 直前の行が識別子・リテラル・) ] で終わっていれば、この "(" は呼び出しとして連結される
        const prev = (lines[i - 1] ?? '').trim()
        return /[\w)\]'"`]$/.test(prev)
      })
      expect(offending, file).toEqual([])
    }
  })

  it('HTML の CSS / JS 参照に ?v=__ASSET_VERSION__ が付いている', () => {
    for (const name of ['index.html', 'teacher.html']) {
      const html = readFileSync(join(webDir, 'public', name), 'utf8')
      const refs = [...html.matchAll(/(?:href|src)="([^"]+\.(?:css|js)[^"]*)"/g)].map((m) => m[1]!)
      expect(refs.length, name).toBeGreaterThan(0)
      for (const ref of refs) expect(ref, `${name}: ${ref}`).toMatch(/\?v=__ASSET_VERSION__$/)
      // 先頭 / を付けるとトリガーのパスの外に出る
      for (const ref of refs) expect(ref.startsWith('/'), `${name}: ${ref}`).toBe(false)
    }
  })

  it('byId() で参照する id が HTML に存在する', () => {
    const pairs: Array<[string, string]> = [
      ['src/main.js', 'public/index.html'],
      ['src/teacher/main.js', 'public/teacher.html'],
    ]
    for (const [js, html] of pairs) {
      const src = readFileSync(join(webDir, js), 'utf8')
      const page = readFileSync(join(webDir, html), 'utf8')
      const ids = new Set([...src.matchAll(/byId\('([^']+)'\)/g)].map((m) => m[1]!))
      for (const id of ids) expect(page.includes(`id="${id}"`), `${html} に id="${id}" が無い（${js} が参照）`).toBe(true)
    }
  })
})
