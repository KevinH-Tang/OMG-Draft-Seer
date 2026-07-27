import { SUPPORTED_HEIGHT, SUPPORTED_WIDTH } from './layout'
import type { Point, Quad, SlotCategory } from '../types'

interface Vector3 {
  x: number
  y: number
  z: number
}

interface SourceEntityTransform {
  origin: Vector3
  angles: Vector3
  scales: Vector3
}

interface ModelFace {
  minimumX: number
  maximumX: number
  minimumY: number
  maximumY: number
  z: number
}

export type ResourceLayoutPoint = Point
export type ResourceLayoutQuad = Quad

export interface ResourceProjectedSlot {
  index: number
  category: SlotCategory
  center: ResourceLayoutPoint
  outerQuad: ResourceLayoutQuad
  matchQuad: ResourceLayoutQuad
}

interface ResourceSlotEntity {
  category: SlotCategory
  image: SourceEntityTransform
  block: SourceEntityTransform
}

const CAMERA_ORIGIN = vector(260.980865, -0.347879, 675.013245)
const CAMERA_ANGLES = vector(63.310432, 179.989059, 0)
const CAMERA_VERTICAL_FOV = 45

const IMAGE_TEXTURE_FACE: ModelFace = {
  minimumX: -12.448561668395996,
  maximumX: 12.448561668395996,
  minimumY: -12.448561668395996,
  maximumY: 12.448561668395996,
  z: 1.1875,
}

const BLOCK_FACE: ModelFace = {
  minimumX: -13.103751182556152,
  maximumX: 13.10374641418457,
  minimumY: -13.103751182556152,
  maximumY: 13.10374641418457,
  z: 25.437501907348633,
}

const ABILITY_ROW_X = [-84, -48, -12, 44, 80, 116] as const
const ABILITY_COLUMN_Y = [-96, -60, -24, 24, 60, 96] as const
const HERO_COLUMN_Y = [-144, 144] as const
const ULTIMATE_COLUMN_Y = [-110, -66, -22, 22, 66, 110] as const

const ULTIMATE_ROWS = [
  {
    imageOrigin: vector(-147.718842, 0, 213.281158),
    blockOrigin: vector(-166.81073, 0, 194.18927),
  },
  {
    imageOrigin: vector(-116.718849, 0, 182.281158),
    blockOrigin: vector(-135.81073, 0, 163.18927),
  },
] as const

const ZERO_ANGLES = vector(0, 0, 0)
const UNIT_SCALE = vector(1, 1, 1)
const ULTIMATE_ANGLES = vector(45, 0, 0)
const ULTIMATE_SCALE = vector(1.1, 1.1, 1.1)

function vector(x: number, y: number, z: number): Vector3 {
  return { x, y, z }
}

function entity(
  origin: Vector3,
  angles = ZERO_ANGLES,
  scales = UNIT_SCALE,
): SourceEntityTransform {
  return { origin, angles, scales }
}

function buildResourceSlots(): ResourceSlotEntity[] {
  const slots: ResourceSlotEntity[] = []
  for (const rowX of ABILITY_ROW_X) {
    for (const columnY of HERO_COLUMN_Y) {
      slots.push({
        category: 'hero',
        image: entity(vector(rowX, columnY, 167.853455)),
        block: entity(vector(rowX, columnY, 143.853455)),
      })
    }
  }
  for (const rowX of ABILITY_ROW_X) {
    for (const columnY of ABILITY_COLUMN_Y) {
      slots.push({
        category: 'ability',
        image: entity(vector(rowX, columnY, 167.853455)),
        block: entity(vector(rowX, columnY, 143.853455)),
      })
    }
  }
  for (const row of ULTIMATE_ROWS) {
    for (const columnY of ULTIMATE_COLUMN_Y) {
      slots.push({
        category: 'ultimate',
        image: entity(
          vector(row.imageOrigin.x, columnY, row.imageOrigin.z),
          ULTIMATE_ANGLES,
          ULTIMATE_SCALE,
        ),
        block: entity(
          vector(row.blockOrigin.x, columnY, row.blockOrigin.z),
          ULTIMATE_ANGLES,
          ULTIMATE_SCALE,
        ),
      })
    }
  }
  return slots
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

function sourceAxes(angles: Vector3): {
  forward: Vector3
  left: Vector3
  up: Vector3
} {
  const pitch = degreesToRadians(angles.x)
  const yaw = degreesToRadians(angles.y)
  const roll = degreesToRadians(angles.z)
  const sinePitch = Math.sin(pitch)
  const cosinePitch = Math.cos(pitch)
  const sineYaw = Math.sin(yaw)
  const cosineYaw = Math.cos(yaw)
  const sineRoll = Math.sin(roll)
  const cosineRoll = Math.cos(roll)
  return {
    forward: vector(cosinePitch * cosineYaw, cosinePitch * sineYaw, -sinePitch),
    left: vector(
      sinePitch * sineRoll * cosineYaw - cosineRoll * sineYaw,
      sinePitch * sineRoll * sineYaw + cosineRoll * cosineYaw,
      sineRoll * cosinePitch,
    ),
    up: vector(
      sinePitch * cosineRoll * cosineYaw + sineRoll * sineYaw,
      sinePitch * cosineRoll * sineYaw - sineRoll * cosineYaw,
      cosineRoll * cosinePitch,
    ),
  }
}

function add(left: Vector3, right: Vector3): Vector3 {
  return vector(left.x + right.x, left.y + right.y, left.z + right.z)
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return vector(left.x - right.x, left.y - right.y, left.z - right.z)
}

function scale(value: Vector3, factor: number): Vector3 {
  return vector(value.x * factor, value.y * factor, value.z * factor)
}

function dot(left: Vector3, right: Vector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function transformModelPoint(
  point: Vector3,
  transform: SourceEntityTransform,
): Vector3 {
  const axes = sourceAxes(transform.angles)
  return add(
    transform.origin,
    add(
      scale(axes.forward, point.x * transform.scales.x),
      add(
        scale(axes.left, point.y * transform.scales.y),
        scale(axes.up, point.z * transform.scales.z),
      ),
    ),
  )
}

function projectWorldPoint(
  point: Vector3,
  width: number,
  height: number,
): ResourceLayoutPoint {
  const cameraAxes = sourceAxes(CAMERA_ANGLES)
  const cameraRight = scale(cameraAxes.left, -1)
  const relative = subtract(point, CAMERA_ORIGIN)
  const depth = dot(relative, cameraAxes.forward)
  if (depth <= 0)
    throw new Error('Ability Draft resource point is behind camera')
  if (width / height >= 4 / 3) {
    const focalLength =
      height / (2 * Math.tan(degreesToRadians(CAMERA_VERTICAL_FOV) / 2))
    return {
      x: width / 2 + (dot(relative, cameraRight) / depth) * focalLength,
      y: height / 2 - (dot(relative, cameraAxes.up) / depth) * focalLength,
    }
  }
  const referenceFocalLength =
    SUPPORTED_HEIGHT / (2 * Math.tan(degreesToRadians(CAMERA_VERTICAL_FOV) / 2))
  const referencePoint = {
    x:
      SUPPORTED_WIDTH / 2 +
      (dot(relative, cameraRight) / depth) * referenceFocalLength,
    y:
      SUPPORTED_HEIGHT / 2 -
      (dot(relative, cameraAxes.up) / depth) * referenceFocalLength,
  }
  const viewportHeight = Math.min(height, (width * 3) / 4)
  const viewportScale = viewportHeight / SUPPORTED_HEIGHT
  return {
    x: width / 2 + (referencePoint.x - SUPPORTED_WIDTH / 2) * viewportScale,
    y: height / 2 + (referencePoint.y - SUPPORTED_HEIGHT / 2) * viewportScale,
  }
}

function projectModelPoint(
  point: Vector3,
  transform: SourceEntityTransform,
  width: number,
  height: number,
): ResourceLayoutPoint {
  return projectWorldPoint(transformModelPoint(point, transform), width, height)
}

function projectModelFace(
  face: ModelFace,
  transform: SourceEntityTransform,
  width: number,
  height: number,
): ResourceLayoutQuad {
  return {
    topLeft: projectModelPoint(
      vector(face.minimumX, face.minimumY, face.z),
      transform,
      width,
      height,
    ),
    topRight: projectModelPoint(
      vector(face.minimumX, face.maximumY, face.z),
      transform,
      width,
      height,
    ),
    bottomRight: projectModelPoint(
      vector(face.maximumX, face.maximumY, face.z),
      transform,
      width,
      height,
    ),
    bottomLeft: projectModelPoint(
      vector(face.maximumX, face.minimumY, face.z),
      transform,
      width,
      height,
    ),
  }
}

export function projectAbilityDraftResourceSlots(
  width = SUPPORTED_WIDTH,
  height = SUPPORTED_HEIGHT,
): ResourceProjectedSlot[] {
  return buildResourceSlots().map((slot, index) => ({
    index,
    category: slot.category,
    center: projectModelPoint(
      vector(0, 0, IMAGE_TEXTURE_FACE.z),
      slot.image,
      width,
      height,
    ),
    outerQuad: projectModelFace(BLOCK_FACE, slot.block, width, height),
    matchQuad: projectModelFace(IMAGE_TEXTURE_FACE, slot.image, width, height),
  }))
}
