// Convierte src/content/conservation/shelf-life.json en una migración que reemplaza la guía entera.
//
// Uso: npm run shelf-life:migration [-- marca-de-tiempo]
// Cada cambio de los plazos necesita una migración nueva: las ya aplicadas no se vuelven a ejecutar.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCatalog } from './buildCatalogMigration.ts'

export interface ShelfLifeEntry {
  item?: string
  category?: string
  state: 'opened' | 'frozen' | 'thawed' | 'cooked' | 'closed_fridge' | 'closed_pantry'
  min_days: number | null
  max_days: number | null
  source: string
  note_es: string
  note_en: string
}

const root = join(import.meta.dirname, '..')
const contentDir = join(root, 'src', 'content', 'conservation')

export function readShelfLife(): ShelfLifeEntry[] {
  return JSON.parse(readFileSync(join(contentDir, 'shelf-life.json'), 'utf8')).entries
}

export function readSourceIds(): string[] {
  return JSON.parse(readFileSync(join(contentDir, 'sources.json'), 'utf8')).sources.map((source: { id: string }) => source.id)
}

/** Devuelve los problemas encontrados; una lista vacía es que todo está bien. */
export function validateShelfLife(entries: ShelfLifeEntry[], slugs: string[], categories: string[], sourceIds: string[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = entry.item ? `item:${entry.item}:${entry.state}` : `category:${entry.category}:${entry.state}`
    if (seen.has(key)) problems.push(`repetida: ${key}`)
    seen.add(key)
    if (Boolean(entry.item) === Boolean(entry.category)) problems.push(`${key}: debe tener item o category, no los dos`)
    if (entry.item && !slugs.includes(entry.item)) problems.push(`${key}: el catálogo no tiene ${entry.item}`)
    if (entry.category && !categories.includes(entry.category)) problems.push(`${key}: categoría desconocida`)
    if (!sourceIds.includes(entry.source)) problems.push(`${key}: fuente desconocida ${entry.source}`)
    if ((entry.min_days === null) !== (entry.max_days === null)) problems.push(`${key}: min_days y max_days van juntos`)
    if (entry.min_days !== null && entry.max_days !== null && (entry.min_days < 1 || entry.max_days < entry.min_days)) {
      problems.push(`${key}: plazo imposible`)
    }
    if (!entry.note_es.trim() || !entry.note_en.trim()) problems.push(`${key}: falta la nota`)
  }
  return problems
}

function text(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function days(value: number | null) {
  return value === null ? 'null' : String(value)
}

export function buildShelfLifeSql(entries: ShelfLifeEntry[]) {
  const statements = entries.map((entry) => {
    const values = [
      `${text(entry.state)}::public.shelf_state`,
      days(entry.min_days),
      days(entry.max_days),
      text(entry.note_es),
      text(entry.note_en),
      text(entry.source),
    ].join(', ')
    return entry.item
      ? `insert into public.shelf_life_guide (catalog_item_id, state, min_days, max_days, note_es, note_en, source)\nselect id, ${values} from public.catalog_items where slug = ${text(entry.item)};`
      : `insert into public.shelf_life_guide (category, state, min_days, max_days, note_es, note_en, source)\nvalues (${text(entry.category!)}::public.category, ${values});`
  })

  return `-- Generado con npm run shelf-life:migration a partir de src/content/conservation/shelf-life.json.
-- No editar a mano. Reemplaza la guía entera.

delete from public.shelf_life_guide;

${statements.join('\n\n')}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = readShelfLife()
  const catalog = readCatalog()
  const problems = validateShelfLife(
    entries,
    catalog.map((item) => item.slug),
    [...new Set(catalog.map((item) => item.category))],
    readSourceIds(),
  )
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  const stamp = process.argv[2] ?? new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const file = join(root, 'supabase', 'migrations', `${stamp}_shelf_life_seed.sql`)
  writeFileSync(file, buildShelfLifeSql(entries))
  console.log(`Migración creada: ${file}`)
}
