import { projectAbilityDraftResourceSlots } from './dota2-ability-draft-resource-layout'
import { clampRectToCanvas, type RuntimeSlot } from './layout'
import type { Point, Quad, Rect } from '../types'

function quadPoints(quad: Quad): [Point, Point, Point, Point] {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
}

export function quadBounds(quad: Quad): Rect {
  const points = quadPoints(quad)
  const minimumX = Math.min(...points.map((point) => point.x))
  const maximumX = Math.max(...points.map((point) => point.x))
  const minimumY = Math.min(...points.map((point) => point.y))
  const maximumY = Math.max(...points.map((point) => point.y))
  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  }
}

function signedQuadArea(quad: Quad): number {
  const points = quadPoints(quad)
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return area + point.x * next.y - next.x * point.y
  }, 0)
}

function isValidQuad(quad: Quad, width: number, height: number): boolean {
  const points = quadPoints(quad)
  return (
    Math.abs(signedQuadArea(quad)) > 1 &&
    points.every(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= width &&
        point.y <= height,
    )
  )
}

export function buildProjectedLayout(
  width: number,
  height: number,
): RuntimeSlot[] | undefined {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return undefined
  let projected
  try {
    projected = projectAbilityDraftResourceSlots(width, height)
  } catch {
    return undefined
  }
  if (
    projected.length !== 60 ||
    projected.some(
      (slot) =>
        !isValidQuad(slot.outerQuad, width, height) ||
        !isValidQuad(slot.matchQuad, width, height),
    )
  )
    return undefined
  return projected.map((slot) => ({
    category: slot.category,
    rect: clampRectToCanvas(quadBounds(slot.outerQuad), width, height),
    matchQuad: slot.matchQuad,
  }))
}
