import { z } from 'zod'

export const apiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() })
})
export type ApiError = z.infer<typeof apiError>

export const scope = z.enum([
  'project:view', 'project:edit', 'project:members', 'archive:view', 'archive:edit', 'archive:import',
  'knowledge:query', 'source:preview', 'source:download', 'library:catalog',
  'library:export', 'report:view', 'report:export'
])
export type Scope = z.infer<typeof scope>

export const session = z.object({
  userId: z.string().min(1), username: z.string().min(1), admin: z.boolean(),
  scopes: z.array(scope), expiresAt: z.string().datetime()
})
export const loginInput = z.object({
  username: z.string().min(1).max(32), password: z.string().min(1).max(128)
})
export type Session = z.infer<typeof session>

export const precision = z.object({
  status: z.enum(['surveyed', 'approximate', 'unknown']),
  sourceCrs: z.string().nullable(),
  registrationMethod: z.string().nullable(),
  errorMeters: z.number().nonnegative().nullable(),
  verifiedAt: z.string().datetime().nullable(),
  note: z.string().nullable()
})
export type Precision = z.infer<typeof precision>

export const layer = z.object({
  layerId: z.string().min(1), name: z.string().min(1), kind: z.string(),
  schemaId: z.string().nullable(), schemaVersion: z.number().int().positive(),
  sourceId: z.string().nullable(), geometryType: z.enum(['Point','LineString','Polygon','MultiPoint','MultiLineString','MultiPolygon','GeometryCollection','mixed']),
  fieldIds: z.array(z.string()), precision
})
export const featureRef = z.object({ layerId: z.string().min(1), featureId: z.string().min(1) })
export type FeatureRef = z.infer<typeof featureRef>

export const project = z.object({
  id: z.string().min(1), name: z.string().min(1), version: z.number().int().positive(),
  role: z.enum(['admin','editor','viewer']), updatedAt: z.string().datetime(),
  updatedBy: z.string().min(1)
})
export const projectSave = z.object({
  expectedVersion: z.number().int().positive(),
  draftRevision: z.number().int().nonnegative(),
  state: z.record(z.string(), z.unknown())
})
export type ProjectSave = z.infer<typeof projectSave>

export const fileRecord = z.object({
  fileId: z.string().min(1), projectId: z.string().min(1), name: z.string(),
  mimeType: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime()
})

export const capability = z.object({
  id: z.string(), available: z.boolean(), reason: z.string().nullable(),
  mock: z.boolean().default(false)
})
export type Capability = z.infer<typeof capability>
