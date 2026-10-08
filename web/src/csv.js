// @ts-check
/**
 * 名簿テキストの解釈。Excel からのコピペ（タブ区切り）と CSV（カンマ区切り）の両方を受ける。
 *   列: 学籍番号, 氏名, クラス（省略可）
 *   1 行目の学籍番号が ID の形でなければ見出し行とみなして飛ばす
 * 検証そのものはサーバの Zod が行う。ここは行を配列に直すだけ。
 */

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/

/**
 * 1 行を列に分ける。タブがあればタブ区切り、無ければカンマ区切り。
 * カンマ区切りでは "..." で囲まれた中のカンマを区切りとみなさない（"" は " に戻す）。
 * @param {string} line @returns {string[]}
 */
function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim())
  /** @type {string[]} */
  const cells = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

/**
 * @param {string} text
 * @returns {{ students: { studentId: string, name: string, className: string }[], skippedHeader: boolean, errors: string[] }}
 */
export function parseRoster(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  /** @type {{ studentId: string, name: string, className: string }[]} */
  const students = []
  /** @type {string[]} */
  const errors = []
  let skippedHeader = false

  lines.forEach((line, i) => {
    const [studentId = '', name = '', className = ''] = splitLine(line)
    if (i === 0 && !ID_RE.test(studentId)) {
      skippedHeader = true
      return
    }
    if (!ID_RE.test(studentId)) {
      errors.push(`${i + 1} 行目: 学籍番号が不正（${studentId || '空'}）`)
      return
    }
    if (!name) {
      errors.push(`${i + 1} 行目: 氏名が空`)
      return
    }
    students.push({ studentId, name, className })
  })
  return { students, skippedHeader, errors }
}

/**
 * @param {string[][]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  const esc = (/** @type {string} */ v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return rows.map((r) => r.map(esc).join(',')).join('\r\n')
}
