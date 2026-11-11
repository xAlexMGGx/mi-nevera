import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCatalog } from '../scripts/buildCatalogMigration'
import { buildShelfLifeSql, readShelfLife, readSourceIds, validateShelfLife } from '../scripts/buildShelfLifeMigration'
import { categories } from '../src/domain/types'
import { createTestDb } from './db/harness'

const entries = readShelfLife()
const catalog = readCatalog()

describe('plazos orientativos de conservación', () => {
  it('cada plazo cita una fuente conocida y apunta a un alimento o categoría que existe', () => {
    expect(validateShelfLife(entries, catalog.map((item) => item.slug), [...categories], readSourceIds())).toEqual([])
  })

  it('la validación detecta los errores típicos', () => {
    const problems = validateShelfLife(
      [
        { item: 'no-existe', state: 'opened', min_days: 3, max_days: 2, source: 'inventada', note_es: 'x', note_en: 'x' },
        { category: 'fish', state: 'thawed', min_days: 1, max_days: null, source: 'fda-chart-2018', note_es: '', note_en: 'x' },
      ],
      ['leche'],
      ['fish'],
      ['fda-chart-2018'],
    )
    expect(problems.join('\n')).toMatch(/no tiene no-existe/)
    expect(problems.join('\n')).toMatch(/fuente desconocida/)
    expect(problems.join('\n')).toMatch(/plazo imposible/)
    expect(problems.join('\n')).toMatch(/van juntos/)
    expect(problems.join('\n')).toMatch(/falta la nota/)
  })

  it('las fuentes de los textos de la guía existen', () => {
    const ids = readSourceIds()
    for (const language of ['es', 'en']) {
      const guide = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'content', 'conservation', `guide.${language}.json`), 'utf8'))
      for (const section of guide.sections) {
        for (const item of section.items) {
          for (const source of item.sources ?? []) expect(ids, `${language}: ${item.text}`).toContain(source)
        }
      }
    }
  })

  it('la guía tiene las mismas secciones y frases en los dos idiomas', () => {
    const read = (language: string) =>
      JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'content', 'conservation', `guide.${language}.json`), 'utf8'))
    const shape = (guide: { sections: { id: string; items: { sources?: string[] }[] }[] }) =>
      guide.sections.map((section) => [section.id, section.items.map((item) => item.sources ?? [])])
    expect(shape(read('en'))).toEqual(shape(read('es')))
  })

  it('la última migración de la guía está al día con el JSON', () => {
    const dir = join(import.meta.dirname, '..', 'supabase', 'migrations')
    const latest = readdirSync(dir).filter((file) => file.endsWith('_shelf_life_seed.sql')).sort().at(-1)!
    const onDisk = readFileSync(join(dir, latest), 'utf8').replaceAll('\r\n', '\n')
    expect(onDisk).toBe(buildShelfLifeSql(entries))
  })

  it('se carga entera en la base de datos', async () => {
    const db = await createTestDb()
    const { rows } = await db.query<{ count: number }>('select count(*)::int as count from public.shelf_life_guide')
    expect(rows[0]?.count).toBe(entries.length)
  })
})
