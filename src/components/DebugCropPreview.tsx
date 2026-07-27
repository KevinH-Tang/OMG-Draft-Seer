import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Rect } from '../types'

const DEBUG_CONTEXT_PADDING = 12
const DEBUG_PREVIEW_SIZE = 240
const DEBUG_BORDER_WIDTH = 2

export function DebugCropPreview({
  imageUrl,
  crop,
}: {
  imageUrl: string
  crop: Rect
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const cropRef = useRef(crop)
  cropRef.current = crop

  useEffect(() => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      imageRef.current = image
      drawPreview()
    }
    image.src = imageUrl
    return () => {
      image.onload = null
      if (imageRef.current === image) imageRef.current = null
    }
  }, [imageUrl])

  useEffect(() => {
    const frame = requestAnimationFrame(() => drawPreview())
    return () => cancelAnimationFrame(frame)
  }, [crop.x, crop.y, crop.width, crop.height])

  function drawPreview() {
    const image = imageRef.current
    const canvas = canvasRef.current
    if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) return

    const currentCrop = cropRef.current
    const left = Math.max(0, Math.floor(currentCrop.x - DEBUG_CONTEXT_PADDING))
    const top = Math.max(0, Math.floor(currentCrop.y - DEBUG_CONTEXT_PADDING))
    const right = Math.min(
      image.naturalWidth,
      Math.ceil(currentCrop.x + currentCrop.width + DEBUG_CONTEXT_PADDING),
    )
    const bottom = Math.min(
      image.naturalHeight,
      Math.ceil(currentCrop.y + currentCrop.height + DEBUG_CONTEXT_PADDING),
    )
    const sourceWidth = Math.max(1, right - left)
    const sourceHeight = Math.max(1, bottom - top)
    const scale = Math.min(
      DEBUG_PREVIEW_SIZE / sourceWidth,
      DEBUG_PREVIEW_SIZE / sourceHeight,
    )
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale))
    const drawHeight = Math.max(1, Math.round(sourceHeight * scale))
    const offsetX = Math.floor((DEBUG_PREVIEW_SIZE - drawWidth) / 2)
    const offsetY = Math.floor((DEBUG_PREVIEW_SIZE - drawHeight) / 2)
    canvas.width = DEBUG_PREVIEW_SIZE
    canvas.height = DEBUG_PREVIEW_SIZE
    const context = canvas.getContext('2d')
    if (!context) return
    context.imageSmoothingEnabled = false
    context.fillStyle = '#050706'
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(
      image,
      left,
      top,
      sourceWidth,
      sourceHeight,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight,
    )
    context.strokeStyle = '#ffefad'
    context.lineWidth = DEBUG_BORDER_WIDTH
    context.strokeRect(
      offsetX + (currentCrop.x - left) * scale + 0.5,
      offsetY + (currentCrop.y - top) * scale + 0.5,
      currentCrop.width * scale,
      currentCrop.height * scale,
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className="block size-60 max-w-full border border-border-strong [image-rendering:pixelated] max-[600px]:justify-self-center"
      width={DEBUG_PREVIEW_SIZE}
      height={DEBUG_PREVIEW_SIZE}
      aria-label={t('layout.cropPreview')}
    />
  )
}
