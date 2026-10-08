// @ts-check
/**
 * QR の描画。qrcode-generator でモジュール行列を作り、canvas に自前で塗る
 * （createSvgTag などは HTML 文字列を返すので innerHTML が要る。使わない）。
 */
import qrcode from 'qrcode-generator'

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {number} cssSize 表示サイズ（CSS px）
 */
export function drawQr(canvas, text, cssSize) {
  const qr = qrcode(0, 'M')
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  const margin = 3
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const cell = Math.max(1, Math.floor((cssSize * dpr) / (n + margin * 2)))
  const px = cell * (n + margin * 2)

  canvas.width = px
  canvas.height = px
  canvas.style.width = `${cssSize}px`
  canvas.style.height = `${cssSize}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = '#000000'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell)
    }
  }
}
