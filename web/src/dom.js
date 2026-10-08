// @ts-check
/**
 * 描画ユーティリティ。
 *
 * ★ innerHTML は使わない。React のような自動エスケープが無いので、
 *   ユーザー入力や外部由来の文字列は必ず textContent で入れる。
 */

/** @param {string} id @returns {HTMLElement} */
export function byId(id) {
  const el = document.getElementById(id)
  if (!el) throw new Error(`要素がありません: #${id}`)
  return el
}

/**
 * @param {string} tag
 * @param {{ class?: string, text?: string, attrs?: Record<string,string>, on?: Record<string, (e: Event) => void> }} [opts]
 * @param {Node[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag)
  if (opts.class) node.className = opts.class
  if (opts.text !== undefined) node.textContent = opts.text
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v)
  for (const [k, v] of Object.entries(opts.on ?? {})) node.addEventListener(k, v)
  for (const c of children) node.appendChild(c)
  return node
}

/** @param {HTMLElement} parent @param {Node[]} children */
export function replaceChildren(parent, children) {
  parent.replaceChildren(...children)
}

/** @param {number} ms @returns {string} 例: 10/08 13:05 */
export function formatTime(ms) {
  const d = new Date(ms)
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** @param {number} ms @returns {string} 例: 13:05:09 */
export function formatClock(ms) {
  const d = new Date(ms)
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** @param {number} ms @returns {string} 例: 2025-10-08 */
export function formatDate(ms) {
  const d = new Date(ms)
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 画面内のビュー切り替え。data-view 属性を持つ section のうち 1 つだけを表示する。
 * @param {string} name
 */
export function showView(name) {
  for (const s of document.querySelectorAll('[data-view]')) {
    const section = /** @type {HTMLElement} */ (s)
    section.hidden = section.dataset['view'] !== name
  }
}

/** 短時間だけ画面下に出す通知 */
let toastTimer = 0
/** @param {string} message @param {'ok' | 'warn' | 'error'} [kind] */
export function toast(message, kind = 'ok') {
  const box = byId('toast')
  box.textContent = message
  box.className = `toast toast-${kind}`
  box.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    box.hidden = true
  }, 2600)
}

/** @param {unknown} err @returns {string} */
export function errorMessage(err) {
  if (err && typeof err === 'object' && 'message' in err) return String(/** @type {{message: unknown}} */ (err).message)
  return String(err)
}
