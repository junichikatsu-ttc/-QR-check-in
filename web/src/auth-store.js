// @ts-check
/**
 * ログイントークンの保存。役割ごとに別キー（同じ端末で生徒・先生の両方を試せる）。
 * localStorage が使えない環境（プライベートモードなど）でも落ちないようにする。
 */

/** @param {'student' | 'teacher'} role */
const key = (role) => `qr-checkin:${role}:token`

/** @param {'student' | 'teacher'} role @returns {string | null} */
export function getToken(role) {
  try {
    return localStorage.getItem(key(role))
  } catch {
    return null
  }
}

/** @param {'student' | 'teacher'} role @param {string} token */
export function setToken(role, token) {
  try {
    localStorage.setItem(key(role), token)
  } catch {
    /* 保存できなくてもこのタブでは動く */
  }
}

/** @param {'student' | 'teacher'} role */
export function clearToken(role) {
  try {
    localStorage.removeItem(key(role))
  } catch {
    /* noop */
  }
}

/** @param {string} k @returns {string} */
export function getPref(k) {
  try {
    return localStorage.getItem(`qr-checkin:pref:${k}`) ?? ''
  } catch {
    return ''
  }
}

/** @param {string} k @param {string} v */
export function setPref(k, v) {
  try {
    localStorage.setItem(`qr-checkin:pref:${k}`, v)
  } catch {
    /* noop */
  }
}
