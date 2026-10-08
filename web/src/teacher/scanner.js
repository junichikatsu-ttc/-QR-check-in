// @ts-check
/**
 * カメラで QR を読む。jsQR（純 JS）で解読するので iOS Safari / Android Chrome の両方で動く。
 * カメラは https か localhost でしか使えない（enebular のトリガー URL は https）。
 *
 * 同じ内容を続けて読んだときは SAME_CODE_COOLDOWN_MS の間は無視する（連打防止）。
 */
import jsQR from 'jsqr'

const SAME_CODE_COOLDOWN_MS = 3000
const DECODE_INTERVAL_MS = 120
const MAX_SIDE = 640

/**
 * @param {HTMLVideoElement} video
 * @param {(text: string) => void} onCode
 * @param {(message: string) => void} onError
 */
export function createScanner(video, onCode, onError) {
  /** @type {MediaStream | null} */
  let stream = null
  let running = false
  let lastText = ''
  let lastAt = 0
  let lastDecode = 0
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  function loop() {
    if (!running) return
    requestAnimationFrame(loop)
    const now = performance.now()
    if (now - lastDecode < DECODE_INTERVAL_MS) return
    if (!ctx || video.readyState < video.HAVE_ENOUGH_DATA) return
    lastDecode = now

    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight))
    const w = Math.floor(video.videoWidth * scale)
    const h = Math.floor(video.videoHeight * scale)
    if (w === 0 || h === 0) return
    canvas.width = w
    canvas.height = h
    ctx.drawImage(video, 0, 0, w, h)
    const image = ctx.getImageData(0, 0, w, h)
    const code = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })
    if (!code || !code.data) return
    if (code.data === lastText && Date.now() - lastAt < SAME_CODE_COOLDOWN_MS) return
    lastText = code.data
    lastAt = Date.now()
    onCode(code.data)
  }

  return {
    async start() {
      if (running) return
      if (!navigator.mediaDevices?.getUserMedia) {
        onError('この端末・ブラウザではカメラを使えません（https で開いているか確認してください）')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
      } catch (err) {
        onError(`カメラを起動できません: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      // iOS Safari はこの 2 つが無いと全画面再生になるか再生されない
      video.setAttribute('playsinline', 'true')
      video.muted = true
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        /* autoplay 制限。ユーザー操作後に再試行される */
      }
      running = true
      requestAnimationFrame(loop)
    },
    stop() {
      running = false
      if (stream) for (const t of stream.getTracks()) t.stop()
      stream = null
      video.srcObject = null
    },
    get running() {
      return running
    },
  }
}

/** 読み取り成功の合図。音と振動（対応端末のみ） */
export function beep() {
  try {
    navigator.vibrate?.(80)
  } catch {
    /* noop */
  }
  try {
    const AudioCtx = window.AudioContext || /** @type {any} */ (window).webkitAudioContext
    if (!AudioCtx) return
    const ac = new AudioCtx()
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.frequency.value = 1320
    gain.gain.value = 0.08
    osc.connect(gain).connect(ac.destination)
    osc.start()
    osc.stop(ac.currentTime + 0.12)
    osc.onended = () => void ac.close()
  } catch {
    /* noop */
  }
}
