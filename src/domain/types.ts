// Valores de la base de datos con los que trabaja la interfaz. Los comparte con las Edge Functions.

import type { Category, PrintedDateType, UnitLabel } from '../../supabase/functions/_shared/vocabulary.ts'

export {
  bulkUnits,
  categories,
  contentUnits,
  printedDateTypes,
  quantityKinds,
  unitLabels,
  zoneKinds,
  type BulkUnit,
  type Category,
  type ContentUnit,
  type PrintedDateType,
  type QuantityKind,
  type UnitLabel,
  type ZoneKind,
} from '../../supabase/functions/_shared/vocabulary.ts'

import { unitLabels } from '../../supabase/functions/_shared/vocabulary.ts'

export const categoryIcons: Record<Category, string> = {
  dairy_eggs: '🥛',
  meat: '🥩',
  fish: '🐟',
  fruit: '🍎',
  vegetables: '🥕',
  bread: '🥖',
  pasta_rice_legumes: '🍝',
  canned: '🥫',
  frozen: '🧊',
  drinks: '🧃',
  sauces: '🧂',
  snacks: '🍪',
  breakfast: '☕',
  cooked: '🍲',
  other: '🍽️',
}

/** `feminine` concuerda con "abierta" en español. */
export const feminineUnits: ReadonlySet<UnitLabel> = new Set([
  'unit',
  'piece',
  'bottle',
  'can',
  'bag',
  'tray',
  'box',
  'loaf',
  'serving',
])

export function isUnitLabel(value: string): value is UnitLabel {
  return (unitLabels as readonly string[]).includes(value)
}

export type DateBasis = PrintedDateType | 'reminder'
