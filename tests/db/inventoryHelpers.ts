import type { PGlite, Transaction } from '@electric-sql/pglite'
import { asUser, createTestDb, createUser } from './harness'

export interface Household {
  db: PGlite
  userId: string
  houseId: string
  zones: { fridge: string; freezer: string; pantry: string }
}

export interface LotRow {
  id: string
  zone_id: string
  product_id: string
  quantity: string
  brand: string | null
  printed_date: string | null
  printed_date_type: string | null
  frozen_at: string | null
  thawed_at: string | null
  reminder_date: string | null
  opened_at: string | null
  container_number: number | null
  effective_date: string | null
  effective_basis: string | null
}

export interface UnitRow {
  id: string
  lot_id: string
  remaining_fraction: string
  reminder_date: string | null
  effective_date: string | null
  effective_basis: string | null
}

/** Una casa nueva con su propietario, sobre una base de datos en memoria. */
export async function createHousehold(db?: PGlite): Promise<Household> {
  const database = db ?? (await createTestDb())
  const userId = await createUser(database, { locale: 'es', display_name: 'Ana' })
  const houseId = await asUser(database, userId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(`select public.create_house('Casa') as id`)
    return rows[0]!.id
  })
  const { rows } = await database.query<{ id: string; kind: 'fridge' | 'freezer' | 'pantry' }>(
    `select id, kind from public.zones where house_id = $1`,
    [houseId],
  )
  const zones = Object.fromEntries(rows.map((zone) => [zone.kind, zone.id])) as Household['zones']
  return { db: database, userId, houseId, zones }
}

/** Llama a una función de la API con nombres de parámetro, como hace el cliente. */
export async function rpc<T = string>(
  household: Pick<Household, 'db' | 'userId'>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined)
  const placeholders = entries.map(([key], index) => `${key} => $${index + 1}`).join(', ')
  return asUser(household.db, household.userId, async (tx: Transaction) => {
    const { rows } = await tx.query<{ result: T }>(
      `select public.${name}(${placeholders}) as result`,
      entries.map(([, value]) => value),
    )
    return rows[0]!.result
  })
}

export async function addMilk(household: Household, quantity: number, printedDate: string | null, extra: Record<string, unknown> = {}) {
  return rpc(household, 'add_lot', {
    p_house_id: household.houseId,
    p_zone_id: household.zones.fridge,
    p_quantity: quantity,
    p_name: 'Leche',
    p_category: 'dairy_eggs',
    p_quantity_kind: 'divisible',
    p_unit_label: 'brick',
    p_content_amount: 1,
    p_content_unit: 'l',
    p_printed_date: printedDate ?? undefined,
    p_printed_date_type: printedDate ? 'expiry' : undefined,
    ...extra,
  })
}

export async function lotsOf(household: Household, productId?: string) {
  const { rows } = await household.db.query<LotRow>(
    `select l.*, l.quantity::text as quantity, l.printed_date::text as printed_date,
            l.frozen_at::text as frozen_at, l.thawed_at::text as thawed_at,
            l.reminder_date::text as reminder_date, l.opened_at::text as opened_at,
            l.effective_date::text as effective_date
     from public.lots_with_dates l
     where l.house_id = $1 and ($2::uuid is null or l.product_id = $2)
     order by l.printed_date nulls last, l.created_at`,
    [household.houseId, productId ?? null],
  )
  return rows
}

export async function unitsOf(household: Household) {
  const { rows } = await household.db.query<UnitRow>(
    `select u.*, u.remaining_fraction::text as remaining_fraction, u.reminder_date::text as reminder_date,
            u.effective_date::text as effective_date
     from public.opened_units_with_dates u
     where u.house_id = $1
     order by u.created_at`,
    [household.houseId],
  )
  return rows
}

export async function productIdByName(household: Household, name: string) {
  const { rows } = await household.db.query<{ id: string }>(
    `select id from public.products where house_id = $1 and name = $2`,
    [household.houseId, name],
  )
  return rows[0]?.id
}

export async function movementsOf(household: Household) {
  const { rows } = await household.db.query<{
    id: string
    type: string
    product_name: string
    details: Record<string, unknown>
  }>(`select id, type, product_name, details from public.movements where house_id = $1 order by seq`, [household.houseId])
  return rows
}

/** Cantidades de un producto en forma legible: la cantidad cerrada por fecha y las abiertas. */
export async function stockOf(household: Household, productId: string) {
  const lots = await lotsOf(household, productId)
  const units = await unitsOf(household)
  const lotIds = new Set(lots.map((lot) => lot.id))
  return {
    closed: lots.map((lot) => [lot.printed_date, Number(lot.quantity)]),
    open: units.filter((unit) => lotIds.has(unit.lot_id)).map((unit) => Number(unit.remaining_fraction)),
  }
}
