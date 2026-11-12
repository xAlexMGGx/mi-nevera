// Valores de la base de datos que comparten la app y las Edge Functions.

export const zoneKinds = ['fridge', 'freezer', 'pantry'] as const
export type ZoneKind = (typeof zoneKinds)[number]

export const categories = [
  'dairy_eggs',
  'meat',
  'fish',
  'fruit',
  'vegetables',
  'bread',
  'pasta_rice_legumes',
  'canned',
  'frozen',
  'drinks',
  'sauces',
  'snacks',
  'breakfast',
  'cooked',
  'other',
] as const
export type Category = (typeof categories)[number]

export const quantityKinds = ['count', 'divisible', 'bulk'] as const
export type QuantityKind = (typeof quantityKinds)[number]

export const contentUnits = ['g', 'kg', 'ml', 'l', 'ud'] as const
export type ContentUnit = (typeof contentUnits)[number]

export const bulkUnits = ['g', 'kg', 'ml', 'l'] as const
export type BulkUnit = (typeof bulkUnits)[number]

/** Unidades con nombre traducido y plural. */
export const unitLabels = [
  'unit',
  'piece',
  'egg',
  'yogurt',
  'brick',
  'bottle',
  'can',
  'jar',
  'package',
  'bag',
  'tray',
  'box',
  'loaf',
  'serving',
] as const
export type UnitLabel = (typeof unitLabels)[number]

export const printedDateTypes = ['expiry', 'best_before'] as const
export type PrintedDateType = (typeof printedDateTypes)[number]
