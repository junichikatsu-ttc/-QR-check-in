// @ts-check
/**
 * 生徒の画面。学籍番号でログイン → 自分の QR を表示する。
 * QR は短命（既定 5 分）で、期限の 20% 手前で自動的に取り直す。
 */
import { api, ApiError } from './api.js'
import { clearToken, getToken, setToken } from './auth-store.js'
import { byId, errorMessage, showView, toast } from './dom.js'
import { drawQr } from './qr.js'

/** @type {number} */
let refreshTimer = 0
/** @type {number} */
let tickTimer = 0
/** @type {number} */
let expiresAt = 0
/** @type {WakeLockSentinel | null} */
let wakeLock = null

const auth = () => ({ token: getToken('student') })

/** @param {string} message */
function showLoginError(message) {
  const box = byId('login-error')
  box.textContent = message
  box.hidden = false
}

function stopTimers() {
  clearTimeout(refreshTimer)
  clearInterval(tickTimer)
}

async function logout() {
  stopTimers()
  clearToken('student')
  if (wakeLock) {
    try {
      await wakeLock.release()
    } catch {
      /* noop */
    }
    wakeLock = null
  }
  showView('login')
}

/** 画面が暗転すると先生が読めないので、対応端末では点灯を維持する */
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen')
  } catch {
    /* 非対応・拒否は無視 */
  }
}

function tick() {
  const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  const m = Math.floor(left / 60)
  const s = left % 60
  byId('countdown').textContent = `あと ${m}:${String(s).padStart(2, '0')}`
}

async function refreshQr() {
  stopTimers()
  try {
    const res = await api('/v1/me/qr', auth())
    const canvas = /** @type {HTMLCanvasElement} */ (byId('qr'))
    const size = Math.min(320, Math.floor(window.innerWidth - 64))
    drawQr(canvas, res.qr, size)
    expiresAt = res.expiresAt
    byId('qr-stale').hidden = true
    tick()
    tickTimer = window.setInterval(tick, 1000)
    // 期限の 20% 手前で取り直す。画面を見せている最中に切れないようにする
    refreshTimer = window.setTimeout(() => void refreshQr(), Math.max(5_000, res.ttlSec * 800))
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return void logout()
    byId('qr-stale').hidden = false
    toast(errorMessage(err), 'error')
    refreshTimer = window.setTimeout(() => void refreshQr(), 10_000)
  }
}

async function enter() {
  try {
    const me = await api('/v1/me', auth())
    byId('student-name').textContent = me.student.name
    byId('student-meta').textContent = [me.student.className, me.student.studentId].filter(Boolean).join(' / ')
    showView('qr')
    void keepAwake()
    await refreshQr()
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      clearToken('student')
      showView('login')
      showLoginError(err.message)
      return
    }
    showView('login')
    showLoginError(errorMessage(err))
  }
}

async function login() {
  const input = /** @type {HTMLInputElement} */ (byId('student-id'))
  const studentId = input.value.trim()
  if (!studentId) return
  byId('login-error').hidden = true
  const button = /** @type {HTMLButtonElement} */ (byId('login-button'))
  button.disabled = true
  try {
    const res = await api('/v1/auth/student', { body: { studentId } })
    setToken('student', res.token)
    await enter()
  } catch (err) {
    showLoginError(errorMessage(err))
  } finally {
    button.disabled = false
  }
}

byId('login-form').addEventListener('submit', (e) => {
  e.preventDefault()
  void login()
})
byId('refresh-button').addEventListener('click', () => void refreshQr())
byId('logout-button').addEventListener('click', () => void logout())
document.addEventListener('visibilitychange', () => {
  // バックグラウンドから戻ったら即座に取り直す（タイマーが止まっていることがある）
  if (document.visibilityState === 'visible' && !byId('qr-view').hidden) {
    void keepAwake()
    void refreshQr()
  }
})

if (getToken('student')) void enter()
else showView('login')
