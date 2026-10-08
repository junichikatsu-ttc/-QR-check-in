// @ts-check
/**
 * 先生の画面。ハッシュで画面を切り替える小さな SPA。
 *   #/events        イベント一覧・作成
 *   #/roster        名簿の登録（貼り付け）
 *   #/event/<id>    スキャン / 一覧
 */
import { api, ApiError } from '../api.js'
import { clearToken, getPref, getToken, setPref, setToken } from '../auth-store.js'
import { parseRoster, toCsv } from '../csv.js'
import { byId, el, errorMessage, formatClock, formatDate, formatTime, replaceChildren, showView, toast } from '../dom.js'
import { beep, createScanner } from './scanner.js'

const LIST_REFRESH_MS = 30_000

const auth = () => ({ token: getToken('teacher') })

/** @type {{ eventId: string, name: string, classNames: string[], createdAt: number } | null} */
let currentEvent = null
/** @type {any} */
let currentStatus = null
let listTimer = 0
/** @type {ReturnType<typeof createScanner> | null} */
let scanner = null
/** @type {string[]} */
let rosterClasses = []

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

/** @param {unknown} err */
function handleError(err) {
  if (err instanceof ApiError && err.status === 401) {
    clearToken('teacher')
    location.hash = '#/login'
    toast(err.message, 'warn')
    return
  }
  toast(errorMessage(err), 'error')
}

function stopEventView() {
  clearInterval(listTimer)
  listTimer = 0
  scanner?.stop()
}

// ---------------------------------------------------------------------------
// ログイン
// ---------------------------------------------------------------------------

async function login() {
  const password = /** @type {HTMLInputElement} */ (byId('password')).value
  const name = /** @type {HTMLInputElement} */ (byId('teacher-name')).value.trim()
  if (!password) return
  const button = /** @type {HTMLButtonElement} */ (byId('login-button'))
  button.disabled = true
  byId('login-error').hidden = true
  try {
    const res = await api('/v1/auth/teacher', { body: { password, name } })
    setToken('teacher', res.token)
    setPref('teacherName', name)
    location.hash = '#/events'
  } catch (err) {
    const box = byId('login-error')
    box.textContent = errorMessage(err)
    box.hidden = false
  } finally {
    button.disabled = false
  }
}

// ---------------------------------------------------------------------------
// イベント一覧
// ---------------------------------------------------------------------------

async function loadRosterClasses() {
  const res = await api('/v1/roster', auth())
  const set = new Set()
  for (const s of res.students) if (s.className) set.add(s.className)
  rosterClasses = [...set].sort()
  byId('roster-count').textContent = `名簿: ${res.students.length} 人${res.updatedAt ? `（${formatTime(res.updatedAt)} 更新）` : ''}`
  renderClassChips()
}

function renderClassChips() {
  const box = byId('class-chips')
  if (rosterClasses.length === 0) {
    replaceChildren(box, [el('span', { class: 'muted', text: 'クラス指定なし（名簿にクラス列がありません）' })])
    return
  }
  replaceChildren(
    box,
    rosterClasses.map((cn) =>
      el('label', { class: 'chip' }, [
        el('input', { attrs: { type: 'checkbox', value: cn, name: 'classNames' } }),
        el('span', { text: cn }),
      ]),
    ),
  )
}

/** @param {{ eventId: string, name: string, classNames: string[], createdAt: number }[]} events */
function renderEvents(events) {
  const list = byId('event-list')
  if (events.length === 0) {
    replaceChildren(list, [el('li', { class: 'empty', text: 'まだイベントがありません。上のフォームから作成してください' })])
    return
  }
  replaceChildren(
    list,
    events.map((ev) =>
      el('li', { class: 'row' }, [
        el(
          'a',
          { class: 'row-main', attrs: { href: `#/event/${ev.eventId}` } },
          [
            el('div', { class: 'row-title', text: ev.name }),
            el('div', {
              class: 'row-meta',
              text: `${formatDate(ev.createdAt)} ・ ${ev.classNames.length ? ev.classNames.join(', ') : '全員'}`,
            }),
          ],
        ),
        el('button', {
          class: 'link danger',
          text: '削除',
          on: {
            click: async () => {
              if (!confirm(`「${ev.name}」を削除しますか？`)) return
              try {
                await api(`/v1/events/${ev.eventId}`, { method: 'DELETE', ...auth() })
                await loadEvents()
              } catch (err) {
                handleError(err)
              }
            },
          },
        }),
      ]),
    ),
  )
}

async function loadEvents() {
  try {
    const [events] = await Promise.all([api('/v1/events', auth()), loadRosterClasses()])
    renderEvents(events.events)
  } catch (err) {
    handleError(err)
  }
}

async function createEvent() {
  const input = /** @type {HTMLInputElement} */ (byId('event-name'))
  const name = input.value.trim()
  if (!name) return
  const classNames = [...document.querySelectorAll('input[name="classNames"]:checked')].map(
    (c) => /** @type {HTMLInputElement} */ (c).value,
  )
  try {
    const res = await api('/v1/events', { body: { name, classNames }, ...auth() })
    input.value = ''
    location.hash = `#/event/${res.event.eventId}`
  } catch (err) {
    handleError(err)
  }
}

// ---------------------------------------------------------------------------
// 名簿
// ---------------------------------------------------------------------------

function previewRoster() {
  const text = /** @type {HTMLTextAreaElement} */ (byId('roster-text')).value
  const { students, skippedHeader, errors } = parseRoster(text)
  const classes = new Set(students.map((s) => s.className).filter(Boolean))
  const parts = [`${students.length} 人`]
  if (classes.size) parts.push(`${classes.size} クラス`)
  if (skippedHeader) parts.push('1 行目は見出しとして無視')
  byId('roster-preview').textContent = text.trim() ? parts.join(' / ') : ''
  const errBox = byId('roster-errors')
  replaceChildren(
    errBox,
    errors.slice(0, 10).map((e) => el('li', { text: e })),
  )
  errBox.hidden = errors.length === 0
  return { students, errors }
}

async function saveRoster() {
  const { students, errors } = previewRoster()
  if (errors.length) return toast('エラーのある行を直してください', 'warn')
  if (students.length === 0) return toast('名簿が空です', 'warn')
  if (!confirm(`名簿を ${students.length} 人で置き換えます。よろしいですか？`)) return
  const button = /** @type {HTMLButtonElement} */ (byId('roster-save'))
  button.disabled = true
  try {
    await api('/v1/roster', { method: 'PUT', body: { students }, ...auth() })
    toast(`名簿を保存しました（${students.length} 人）`)
    location.hash = '#/events'
  } catch (err) {
    if (err instanceof ApiError && err.code === 'VALIDATION' && Array.isArray(err.details)) {
      const errBox = byId('roster-errors')
      replaceChildren(
        errBox,
        err.details.slice(0, 10).map((d) => el('li', { text: `${d.path}: ${d.message}` })),
      )
      errBox.hidden = false
      return
    }
    handleError(err)
  } finally {
    button.disabled = false
  }
}

async function loadRosterIntoEditor() {
  try {
    const res = await api('/v1/roster', auth())
    const ta = /** @type {HTMLTextAreaElement} */ (byId('roster-text'))
    if (!ta.value.trim() && res.students.length) {
      ta.value = res.students.map((s) => [s.studentId, s.name, s.className].join('\t')).join('\n')
    }
    previewRoster()
  } catch (err) {
    handleError(err)
  }
}

// ---------------------------------------------------------------------------
// イベント詳細（スキャン / 一覧）
// ---------------------------------------------------------------------------

/** @param {'scan' | 'list'} tab */
function switchTab(tab) {
  byId('tab-scan').classList.toggle('active', tab === 'scan')
  byId('tab-list').classList.toggle('active', tab === 'list')
  byId('pane-scan').hidden = tab !== 'scan'
  byId('pane-list').hidden = tab !== 'list'
  setPref('tab', tab)
  if (tab === 'scan') {
    clearInterval(listTimer)
    listTimer = 0
    void scanner?.start()
  } else {
    scanner?.stop()
    void loadStatus()
    if (!listTimer) listTimer = window.setInterval(() => document.visibilityState === 'visible' && void loadStatus(), LIST_REFRESH_MS)
  }
}

/** @param {any} status */
function renderSummary(status) {
  const s = status.summary
  byId('summary').textContent = `${s.checkedIn} / ${s.total}`
  byId('summary-sub').textContent = s.remaining === 0 && s.total > 0 ? '全員チェックイン済み' : `未: ${s.remaining} 人`
  byId('summary').classList.toggle('done', s.remaining === 0 && s.total > 0)
}

function currentFilter() {
  const checked = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="filter"]:checked'))
  return checked?.value ?? 'all'
}

/** @param {any} status */
function renderList(status) {
  renderSummary(status)
  const filter = currentFilter()
  const q = /** @type {HTMLInputElement} */ (byId('search')).value.trim().toLowerCase()
  /** @type {any[]} */
  let students = status.students
  if (filter === 'remaining') students = students.filter((s) => !s.checkin)
  if (filter === 'done') students = students.filter((s) => s.checkin)
  if (q) students = students.filter((s) => `${s.name} ${s.studentId} ${s.className}`.toLowerCase().includes(q))

  /** @type {Map<string, any[]>} */
  const groups = new Map()
  for (const s of students) {
    const key = s.className || '（クラスなし）'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push(s)
  }

  const list = byId('student-list')
  if (students.length === 0) {
    replaceChildren(list, [el('li', { class: 'empty', text: status.students.length === 0 ? '対象の生徒がいません（名簿とクラス指定を確認）' : '該当なし' })])
  } else {
    /** @type {Node[]} */
    const nodes = []
    for (const [cn, members] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ja'))) {
      const done = members.filter((m) => m.checkin).length
      nodes.push(el('li', { class: 'group' }, [el('span', { text: cn }), el('span', { class: 'muted', text: `${done} / ${members.length}` })]))
      for (const s of members) nodes.push(renderStudentRow(s))
    }
    replaceChildren(list, nodes)
  }

  const extraBox = byId('extra-box')
  const extra = byId('extra-list')
  if (status.extra.length === 0) {
    extraBox.hidden = true
  } else {
    extraBox.hidden = false
    replaceChildren(extra, status.extra.map((s) => renderStudentRow({ ...s, extra: true })))
  }
}

/** @param {any} s */
function renderStudentRow(s) {
  const ck = s.checkin
  const meta = ck
    ? [formatClock(ck.checkedInAt), ck.point, ck.method === 'manual' ? '手動' : '', ck.by].filter(Boolean).join(' ・ ')
    : '未チェックイン'
  return el('li', { class: `row student ${ck ? 'done' : 'pending'}` }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title', text: `${s.name || '（名簿にない）'}` }),
      el('div', { class: 'row-meta', text: `${s.studentId}${s.className ? ' ・ ' + s.className : ''}` }),
      el('div', { class: `row-meta ${ck ? 'ok' : 'warn'}`, text: meta }),
    ]),
    ck
      ? el('button', {
          class: 'link',
          text: '取消',
          on: {
            click: async () => {
              if (!confirm(`${s.name || s.studentId} のチェックインを取り消しますか？`)) return
              try {
                await api(`/v1/events/${currentEvent?.eventId}/checkins/${encodeURIComponent(s.studentId)}`, {
                  method: 'DELETE',
                  ...auth(),
                })
                await loadStatus()
              } catch (err) {
                handleError(err)
              }
            },
          },
        })
      : el('button', {
          class: 'link',
          text: '手動',
          on: { click: () => void checkin({ studentId: s.studentId }) },
        }),
  ])
}

async function loadStatus() {
  if (!currentEvent) return
  try {
    currentStatus = await api(`/v1/events/${currentEvent.eventId}`, auth())
    renderList(currentStatus)
  } catch (err) {
    handleError(err)
  }
}

/**
 * @param {{ qr?: string, studentId?: string }} payload
 */
async function checkin(payload) {
  if (!currentEvent) return
  const point = /** @type {HTMLInputElement} */ (byId('point')).value.trim()
  const result = byId('scan-result')
  try {
    const res = await api(`/v1/events/${currentEvent.eventId}/checkins`, { body: { ...payload, point }, ...auth() })
    const name = res.student ? `${res.student.name}` : `（名簿にない）${res.checkin.studentId}`
    const sub = [res.student?.className, res.checkin.studentId].filter(Boolean).join(' / ')
    if (res.already) {
      showResult('warn', `${name}`, `${sub} ・ すでに ${formatClock(res.checkin.checkedInAt)} にチェックイン済み`)
    } else if (!res.inTarget) {
      showResult('warn', `${name}`, `${sub} ・ 記録しました（このイベントの対象外）`)
      beep()
    } else {
      showResult('ok', `${name}`, `${sub} ・ チェックイン ${formatClock(res.checkin.checkedInAt)}`)
      beep()
    }
    // 一覧の集計だけ軽く更新（スキャン中は query を増やさない）
    if (currentStatus && !res.already && res.inTarget) {
      const s = currentStatus.students.find((/** @type {any} */ x) => x.studentId === res.checkin.studentId)
      if (s && !s.checkin) {
        s.checkin = res.checkin
        currentStatus.summary.checkedIn++
        currentStatus.summary.remaining--
        renderSummary(currentStatus)
      }
    }
    if (payload.studentId) {
      const manualInput = /** @type {HTMLInputElement} */ (byId('manual-id'))
      manualInput.value = ''
      if (!byId('pane-list').hidden) await loadStatus()
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err)
    showResult('error', 'チェックインできません', errorMessage(err))
    result.hidden = false
  }
}

/** @param {'ok' | 'warn' | 'error'} kind @param {string} title @param {string} sub */
function showResult(kind, title, sub) {
  const box = byId('scan-result')
  box.className = `result result-${kind}`
  byId('result-title').textContent = title
  byId('result-sub').textContent = sub
  box.hidden = false
}

/** @param {string} eventId */
async function openEvent(eventId) {
  stopEventView()
  try {
    currentStatus = await api(`/v1/events/${eventId}`, auth())
  } catch (err) {
    handleError(err)
    if (err instanceof ApiError && err.status === 404) location.hash = '#/events'
    return
  }
  currentEvent = currentStatus.event
  byId('event-title').textContent = currentStatus.event.name
  byId('event-sub').textContent = currentStatus.event.classNames.length ? currentStatus.event.classNames.join(', ') : '全員'
  byId('scan-result').hidden = true
  // 注意: 行頭を "(" で始めない（前の行とつながり true(...) と解釈される。ASI の罠）
  const pointInput = /** @type {HTMLInputElement} */ (byId('point'))
  pointInput.value = getPref('point')
  renderList(currentStatus)
  showView('event')

  if (!scanner) {
    const video = /** @type {HTMLVideoElement} */ (byId('video'))
    scanner = createScanner(
      video,
      (text) => void checkin({ qr: text }),
      (message) => {
        byId('camera-error').textContent = message
        byId('camera-error').hidden = false
      },
    )
  }
  switchTab(/** @type {'scan' | 'list'} */ (getPref('tab') || 'scan'))
}

function exportCsv() {
  if (!currentStatus || !currentEvent) return
  const rows = [['学籍番号', '氏名', 'クラス', '状態', '時刻', '地点', '方法', '担当']]
  for (const s of [...currentStatus.students, ...currentStatus.extra]) {
    const ck = s.checkin
    rows.push([
      s.studentId,
      s.name,
      s.className,
      ck ? '済' : '未',
      ck ? formatTime(ck.checkedInAt) : '',
      ck?.point ?? '',
      ck ? (ck.method === 'manual' ? '手動' : 'QR') : '',
      ck?.by ?? '',
    ])
  }
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = el('a', { attrs: { href: url, download: `${currentEvent.name}-${formatDate(Date.now())}.csv` } })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------------------
// ルーティング
// ---------------------------------------------------------------------------

function route() {
  const hash = location.hash || '#/events'
  if (!getToken('teacher') && hash !== '#/login') {
    location.hash = '#/login'
    return
  }
  stopEventView()
  const m = /^#\/event\/(\d+)$/.exec(hash)
  if (hash === '#/login') {
    const nameInput = /** @type {HTMLInputElement} */ (byId('teacher-name'))
    nameInput.value = getPref('teacherName')
    showView('login')
  } else if (hash === '#/roster') {
    showView('roster')
    void loadRosterIntoEditor()
  } else if (m) {
    void openEvent(m[1] ?? '')
  } else {
    showView('events')
    void loadEvents()
  }
}

byId('login-form').addEventListener('submit', (e) => {
  e.preventDefault()
  void login()
})
byId('event-form').addEventListener('submit', (e) => {
  e.preventDefault()
  void createEvent()
})
byId('roster-text').addEventListener('input', () => void previewRoster())
byId('roster-save').addEventListener('click', () => void saveRoster())
byId('tab-scan').addEventListener('click', () => switchTab('scan'))
byId('tab-list').addEventListener('click', () => switchTab('list'))
byId('point').addEventListener('change', () => setPref('point', /** @type {HTMLInputElement} */ (byId('point')).value.trim()))
byId('manual-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const id = /** @type {HTMLInputElement} */ (byId('manual-id')).value.trim()
  if (id) void checkin({ studentId: id })
})
byId('refresh').addEventListener('click', () => void loadStatus())
byId('export').addEventListener('click', exportCsv)
byId('search').addEventListener('input', () => currentStatus && renderList(currentStatus))
for (const r of document.querySelectorAll('input[name="filter"]')) {
  r.addEventListener('change', () => currentStatus && renderList(currentStatus))
}
for (const b of document.querySelectorAll('[data-logout]')) {
  b.addEventListener('click', () => {
    clearToken('teacher')
    location.hash = '#/login'
  })
}
document.addEventListener('visibilitychange', () => {
  if (!byId('event-view').hidden && !byId('pane-scan').hidden) {
    if (document.visibilityState === 'visible') void scanner?.start()
    else scanner?.stop()
  }
})

window.addEventListener('hashchange', route)
route()
