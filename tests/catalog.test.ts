import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCatalogSql, readCatalog } from '../scripts/buildCatalogMigration'
import { bulkUnits, categories, contentUnits, quantityKinds, unitLabels, zoneKinds } from '../src/domain/types'
import { createTestDb } from './db/harness'

const items = readCatalog()

describe('catálogo base', () => {
  it('tiene entre 150 y 200 alimentos, en todas las categorías', () => {
    expect(items.length).toBeGreaterThanOrEqual(150)
    expect(items.length).toBeLessThanOrEqual(200)
    expect(new Set(items.map((item) => item.category))).toEqual(new Set(categories))
  })

  it('no repite identificadores ni nombres', () => {
    for (const field of ['slug', 'name_es', 'name_en'] as const) {
      const values = items.map((item) => item[field].toLowerCase())
      expect(values.filter((value, index) => values.indexOf(value) !== index), field).toEqual([])
    }
  })

  it('todos los valores son válidos', () => {
    for (const item of items) {
      expect(categories, item.slug).toContain(item.category)
      expect(zoneKinds, item.slug).toContain(item.default_zone)
      expect(quantityKinds, item.slug).toContain(item.default_quantity_kind)
      expect(unitLabels, item.slug).toContain(item.default_unit_label)
      expect(item.name_es.trim(), item.slug).not.toBe('')
      expect(item.name_en.trim(), item.slug).not.toBe('')
      expect(item.icon.trim(), item.slug).not.toBe('')
    }
  })

  it('cada tipo de cantidad trae los datos que necesita', () => {
    for (const item of items) {
      if (item.default_quantity_kind === 'divisible') {
        expect(item.default_content_amount, item.slug).toBeGreaterThan(0)
        expect(contentUnits, item.slug).toContain(item.default_content_unit)
      }
      if (item.default_quantity_kind === 'bulk') {
        expect(bulkUnits, item.slug).toContain(item.default_content_unit)
        expect(item.default_content_amount, item.slug).toBeNull()
      }
      if (item.default_quantity_kind === 'count') {
        expect(item.default_content_amount, item.slug).toBeNull()
        expect(item.default_content_unit, item.slug).toBeNull()
      }
    }
  })

  it('la última migración del catálogo está al día con el JSON', () => {
    const dir = join(import.meta.dirname, '..', 'supabase', 'migrations')
    const latest = readdirSync(dir).filter((file) => file.endsWith('_catalog_seed.sql')).sort().at(-1)!
    const onDisk = readFileSync(join(dir, latest), 'utf8').replaceAll('\r\n', '\n')
    expect(onDisk).toBe(buildCatalogSql(items))
  })

  it('se carga en la base de datos', async () => {
    const db = await createTestDb()
    const { rows } = await db.query<{ count: number }>('select count(*)::int as count from public.catalog_items')
    expect(rows[0]?.count).toBe(items.length)
  })
})
