// Convierte supabase/seed/catalog.json en una migración, para no usar claves secretas al cargarlo.
//
// Uso: npm run catalog:migration [-- marca-de-tiempo]
// Cada cambio del catálogo necesita una migración nueva: las ya aplicadas no se vuelven a ejecutar.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CatalogItem {
  slug: string
  name_es: string
  name_en: string
  icon: string
  category: string
  default_zone: string
  default_quantity_kind: string
  default_unit_label: string
  default_content_amount: number | null
  default_content_unit: string | null
  synonyms_es: string[]
  synonyms_en: string[]
}

const root = join(import.meta.dirname, '..')

export function readCatalog(): CatalogItem[] {
  return JSON.parse(readFileSync(join(root, 'supabase', 'seed', 'catalog.json'), 'utf8'))
}

function text(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function textArray(values: string[]) {
  return values.length ? `array[${values.map(text).join(', ')}]::text[]` : `'{}'::text[]`
}

export function buildCatalogSql(items: CatalogItem[]) {
  const rows = items.map((item) =>
    [
      text(item.slug),
      text(item.name_es),
      text(item.name_en),
      text(item.icon),
      `${text(item.category)}::public.category`,
      `${text(item.default_zone)}::public.zone_kind`,
      `${text(item.default_quantity_kind)}::public.quantity_kind`,
      text(item.default_unit_label),
      item.default_content_amount ?? 'null',
      item.default_content_unit ? `${text(item.default_content_unit)}::public.amount_unit` : 'null',
      textArray(item.synonyms_es),
      textArray(item.synonyms_en),
    ].join(', '),
  )

  return `-- Generado con npm run catalog:migration a partir de supabase/seed/catalog.json. No editar a mano.

insert into public.catalog_items (
  slug, name_es, name_en, icon, category, default_zone, default_quantity_kind, default_unit_label,
  default_content_amount, default_content_unit, synonyms_es, synonyms_en
)
values
${rows.map((row) => `  (${row})`).join(',\n')}
on conflict (slug) do update set
  name_es = excluded.name_es,
  name_en = excluded.name_en,
  icon = excluded.icon,
  category = excluded.category,
  default_zone = excluded.default_zone,
  default_quantity_kind = excluded.default_quantity_kind,
  default_unit_label = excluded.default_unit_label,
  default_content_amount = excluded.default_content_amount,
  default_content_unit = excluded.default_content_unit,
  synonyms_es = excluded.synonyms_es,
  synonyms_en = excluded.synonyms_en;
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const stamp = process.argv[2] ?? new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const file = join(root, 'supabase', 'migrations', `${stamp}_catalog_seed.sql`)
  writeFileSync(file, buildCatalogSql(readCatalog()))
  console.log(`Migración creada: ${file}`)
}
