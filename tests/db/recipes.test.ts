import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestDb, createUser } from './harness'
import { addMilk, createHousehold, lotsOf, movementsOf, productIdByName, rpc, stockOf, unitsOf, type Household } from './inventoryHelpers'

let db: PGlite
let household: Household

beforeAll(async () => {
  db = await createTestDb()
})

beforeEach(async () => {
  household = await createHousehold(db)
})

const recipe = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  time_minutes: 20,
  servings: 2,
  ingredients: [{ name: 'Huevos', amount_text: '4 huevos', have: true, matched_product_id: null, use_amount: 4 }],
  steps: ['Batir', 'Cuajar'],
  uses_expiring: [],
  ...extra,
})

async function favoritesOf(who: Pick<Household, 'db' | 'userId'> = household) {
  return asUser(who.db, who.userId, async (tx) => {
    const { rows } = await tx.query<{ id: string; title: string; house_id: string | null; recipe: Record<string, unknown> }>(
      'select id, title, house_id, recipe from public.recipe_favorites order by created_at',
    )
    return rows
  })
}

async function blockedOf(who: Pick<Household, 'db' | 'userId'> = household) {
  return asUser(who.db, who.userId, async (tx) => {
    const { rows } = await tx.query<{ id: string; title: string }>('select id, title from public.recipe_blocked order by created_at')
    return rows
  })
}

function addEggs(quantity: number, printedDate: string | null, who: Household = household) {
  return rpc(who, 'add_lot', {
    p_house_id: who.houseId,
    p_zone_id: who.zones.fridge,
    p_quantity: quantity,
    p_name: 'Huevos',
    p_category: 'dairy_eggs',
    p_quantity_kind: 'count',
    p_unit_label: 'egg',
    p_printed_date: printedDate ?? undefined,
    p_printed_date_type: printedDate ? 'expiry' : undefined,
  })
}

function addFlour(grams: number) {
  return rpc(household, 'add_lot', {
    p_house_id: household.houseId,
    p_zone_id: household.zones.pantry,
    p_quantity: grams,
    p_name: 'Harina',
    p_category: 'pasta_rice_legumes',
    p_quantity_kind: 'bulk',
    p_unit_label: 'unit',
    p_bulk_unit: 'g',
  })
}

function cook(items: { product_id: string; amount: number }[], dish?: Record<string, unknown>, title = 'Tortilla francesa') {
  return rpc(household, 'cook_recipe', { p_house_id: household.houseId, p_title: title, p_items: JSON.stringify(items), p_dish: dish ? JSON.stringify(dish) : undefined })
}

async function quantities(productId: string) {
  return (await lotsOf(household, productId)).map((lot) => Number(lot.quantity))
}

describe('favoritos', () => {
  it('se guardan, son de cada persona y la misma receta no se repite', async () => {
    const first = await rpc(household, 'save_recipe_favorite', { p_house_id: household.houseId, p_recipe: JSON.stringify(recipe('Tortilla de patatas')) })
    const again = await rpc(household, 'save_recipe_favorite', {
      p_house_id: household.houseId,
      p_recipe: JSON.stringify(recipe('  TORTILLA de  patátas ', { servings: 4 })),
    })
    expect(again).toBe(first)
    const favorites = await favoritesOf()
    expect(favorites).toHaveLength(1)
    expect(favorites[0]).toMatchObject({ title: 'TORTILLA de patátas', house_id: household.houseId, recipe: { servings: 4 } })

    const other = await createHousehold(db)
    expect(await favoritesOf(other)).toEqual([])
    await expect(rpc(other, 'delete_recipe_favorite', { p_favorite_id: first })).rejects.toThrow('not_found')
    await rpc(household, 'delete_recipe_favorite', { p_favorite_id: first })
    expect(await favoritesOf()).toEqual([])
  })

  it('siguen ahí aunque se borre la casa donde se guardaron', async () => {
    await rpc(household, 'save_recipe_favorite', { p_house_id: household.houseId, p_recipe: JSON.stringify(recipe('Crema de calabaza')) })
    await rpc(household, 'delete_house', { p_house_id: household.houseId })
    expect(await favoritesOf()).toMatchObject([{ title: 'Crema de calabaza', house_id: null }])
  })

  it('solo desde una casa propia y con título', async () => {
    const other = await createHousehold(db)
    await expect(rpc(other, 'save_recipe_favorite', { p_house_id: household.houseId, p_recipe: JSON.stringify(recipe('Gazpacho')) })).rejects.toThrow('not_member')
    await expect(rpc(household, 'save_recipe_favorite', { p_house_id: household.houseId, p_recipe: JSON.stringify(recipe('   ')) })).rejects.toThrow('invalid_input')
    await expect(rpc(household, 'save_recipe_favorite', { p_house_id: household.houseId, p_recipe: JSON.stringify(['Gazpacho']) })).rejects.toThrow('invalid_input')
  })

  it('el cliente no puede escribirlos directamente', async () => {
    await expect(
      asUser(db, household.userId, (tx) =>
        tx.query(`insert into public.recipe_favorites (user_id, title, title_normalized, recipe) values ($1, 'x', 'x', '{}')`, [household.userId]),
      ),
    ).rejects.toThrow()
  })
})

describe('no me la vuelvas a sugerir', () => {
  it('se bloquea una vez por título y se puede desbloquear', async () => {
    const id = await rpc(household, 'block_recipe', { p_title: 'Lentejas con chorizo' })
    expect(await rpc(household, 'block_recipe', { p_title: 'lentejas con  CHORIZO' })).toBe(id)
    expect(await blockedOf()).toHaveLength(1)

    const other = await createHousehold(db)
    expect(await blockedOf(other)).toEqual([])
    await expect(rpc(other, 'unblock_recipe', { p_blocked_id: id })).rejects.toThrow('not_found')

    await rpc(household, 'unblock_recipe', { p_blocked_id: id })
    expect(await blockedOf()).toEqual([])
    await expect(rpc(household, 'block_recipe', { p_title: '' })).rejects.toThrow('invalid_input')
  })
})

describe('límite diario', () => {
  it('20 sugerencias de recetas al día, aparte de lo demás', async () => {
    const claims: boolean[] = []
    for (let i = 0; i < 21; i++) claims.push(await rpc<boolean>(household, 'claim_ai_use', { p_kind: 'recipe' }))
    expect(claims.filter(Boolean)).toHaveLength(20)
    expect(await rpc<boolean>(household, 'claim_ai_use', { p_kind: 'receipt' })).toBe(true)
  })
})

describe('he cocinado esto', () => {
  it('por unidades, gastando primero lo que caduca antes', async () => {
    await addEggs(3, '2099-02-01')
    await addEggs(3, '2099-01-01')
    const eggs = (await productIdByName(household, 'Huevos'))!
    await cook([{ product_id: eggs, amount: 4 }])
    const lots = await lotsOf(household, eggs)
    expect(lots.map((lot) => [lot.printed_date, Number(lot.quantity)])).toEqual([['2099-02-01', 2]])

    const [movement] = (await movementsOf(household)).slice(-1)
    expect(movement).toMatchObject({ type: 'cooked', product_name: 'Tortilla francesa' })
    expect(movement!.details).toMatchObject({ recipe: 'Tortilla francesa', dish: null, used: [{ name: 'Huevos', amount: 4, quantity_kind: 'count', unit_label: 'egg' }] })
  })

  it('a granel, en su unidad', async () => {
    await addFlour(1000)
    const flour = (await productIdByName(household, 'Harina'))!
    await cook([{ product_id: flour, amount: 250 }])
    expect(await quantities(flour)).toEqual([750])
  })

  it('una parte de un envase: lo abre y queda abierto con el resto', async () => {
    await addMilk(household, 2, '2099-01-01')
    const milk = (await productIdByName(household, 'Leche'))!
    await cook([{ product_id: milk, amount: 0.2 }])
    expect(await stockOf(household, milk)).toEqual({ closed: [['2099-01-01', 1]], open: [0.8] })

    // Primero se gasta lo abierto; lo que falta, de otro envase.
    await cook([{ product_id: milk, amount: 1 }])
    expect(await stockOf(household, milk)).toEqual({ closed: [['2099-01-01', 0]], open: [0.8] })
  })

  it('envases enteros y una parte', async () => {
    await addMilk(household, 3, null)
    const milk = (await productIdByName(household, 'Leche'))!
    await cook([{ product_id: milk, amount: 1.5 }])
    expect(await stockOf(household, milk)).toEqual({ closed: [[null, 1]], open: [0.5] })
  })

  it('lo que queda casi vacío se da por terminado', async () => {
    await addMilk(household, 1, null)
    const milk = (await productIdByName(household, 'Leche'))!
    await rpc(household, 'open_unit', { p_product_id: milk })
    await cook([{ product_id: milk, amount: 0.9995 }])
    expect(await unitsOf(household)).toEqual([])
    expect(await lotsOf(household, milk)).toEqual([])
  })

  it('si hay menos de lo pedido, gasta lo que hay', async () => {
    await addEggs(2, null)
    const eggs = (await productIdByName(household, 'Huevos'))!
    await cook([{ product_id: eggs, amount: 5 }])
    expect(await lotsOf(household, eggs)).toEqual([])
    expect((await movementsOf(household)).at(-1)!.details).toMatchObject({ used: [{ amount: 2 }] })
  })

  it('el historial lo apunta en el orden de la receta', async () => {
    await addEggs(6, null)
    await addMilk(household, 1, null)
    await addFlour(500)
    const eggs = (await productIdByName(household, 'Huevos'))!
    const milk = (await productIdByName(household, 'Leche'))!
    const flour = (await productIdByName(household, 'Harina'))!
    const order = [flour, eggs, milk]
    await cook(order.map((product_id) => ({ product_id, amount: product_id === milk ? 0.1 : 1 })))
    const used = (movementsOf(household).then((rows) => rows.at(-1)!.details.used)) as Promise<{ name: string }[]>
    expect((await used).map((item) => item.name)).toEqual(['Harina', 'Huevos', 'Leche'])
  })

  it('la misma línea dos veces se suma', async () => {
    await addEggs(6, null)
    const eggs = (await productIdByName(household, 'Huevos'))!
    await cook([
      { product_id: eggs, amount: 1 },
      { product_id: eggs, amount: 2 },
    ])
    expect(await quantities(eggs)).toEqual([3])
  })

  it('con lo que ha sobrado guarda un táper, en una sola operación', async () => {
    await addEggs(6, null)
    const eggs = (await productIdByName(household, 'Huevos'))!
    await cook([{ product_id: eggs, amount: 4 }], { servings: 2, zone: 'freezer', reminder_date: '2099-03-01' }, 'Tortilla de patatas')

    const { rows } = await db.query<{ name: string; kind: string; quantity: string; container_number: number; source: string; frozen_at: string | null; reminder_date: string }>(
      `select p.name, p.kind, l.quantity::text, l.container_number, l.source::text, l.frozen_at::text, l.reminder_date::text
       from public.lots l join public.products p on p.id = l.product_id
       where l.house_id = $1 and p.kind = 'cooked_dish'`,
      [household.houseId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Tortilla de patatas', quantity: '2', container_number: 1, source: 'recipe', reminder_date: '2099-03-01' })
    expect(rows[0]!.frozen_at).not.toBeNull()

    const movements = await movementsOf(household)
    expect(movements.filter((movement) => movement.type === 'cooked')).toHaveLength(1)
    expect(movements.at(-1)!.details).toMatchObject({ dish: { servings: 2, zone: 'freezer', container_number: 1 } })
  })

  it('sin ingredientes de casa, también puede guardar solo el táper', async () => {
    await cook([], { servings: 3, zone: 'fridge', name: 'Cocido' }, 'Cocido madrileño')
    expect(await productIdByName(household, 'Cocido')).toBeDefined()
  })

  it('un táper también puede ser ingrediente, y Deshacer lo recupera', async () => {
    await rpc(household, 'add_cooked_dish', { p_house_id: household.houseId, p_zone_id: household.zones.fridge, p_name: 'Arroz blanco', p_servings: 2 })
    const rice = (await productIdByName(household, 'Arroz blanco'))!
    const movement = await cook([{ product_id: rice, amount: 2 }], undefined, 'Arroz a la cubana')
    expect(await productIdByName(household, 'Arroz blanco')).toBeUndefined()

    await rpc(household, 'undo_movement', { p_movement_id: movement })
    expect(await productIdByName(household, 'Arroz blanco')).toBe(rice)
    expect(await quantities(rice)).toEqual([2])
  })

  it('Deshacer lo devuelve todo como estaba, táper incluido', async () => {
    await addEggs(3, '2099-01-01')
    await addEggs(3, '2099-02-01')
    await addMilk(household, 2, null)
    const eggs = (await productIdByName(household, 'Huevos'))!
    const milk = (await productIdByName(household, 'Leche'))!
    const before = { eggs: await stockOf(household, eggs), milk: await stockOf(household, milk) }

    const movement = await cook(
      [
        { product_id: eggs, amount: 4 },
        { product_id: milk, amount: 0.25 },
      ],
      { servings: 2, zone: 'fridge' },
    )
    await rpc(household, 'undo_movement', { p_movement_id: movement })

    expect({ eggs: await stockOf(household, eggs), milk: await stockOf(household, milk) }).toEqual(before)
    expect(await productIdByName(household, 'Tortilla francesa')).toBeUndefined()
    expect((await movementsOf(household)).filter((row) => row.type === 'cooked')).toEqual([])
  })

  it('avisa a los demás móviles de la casa', async () => {
    await addEggs(2, null)
    const eggs = (await productIdByName(household, 'Huevos'))!
    const version = async () => Number((await db.query<{ v: string }>('select version::text as v from public.house_changes where house_id = $1', [household.houseId])).rows[0]!.v)
    const start = await version()
    await cook([{ product_id: eggs, amount: 1 }])
    expect(await version()).toBeGreaterThan(start)
  })

  it('rechaza lo que no cuadra', async () => {
    await addEggs(2, null)
    const eggs = (await productIdByName(household, 'Huevos'))!
    await expect(cook([{ product_id: eggs, amount: 0 }])).rejects.toThrow('invalid_amount')
    await expect(cook([])).rejects.toThrow('invalid_input')
    await expect(rpc(household, 'cook_recipe', { p_house_id: household.houseId, p_title: ' ', p_items: '[]', p_dish: '{"servings":1,"zone":"fridge"}' })).rejects.toThrow('invalid_input')
    await expect(cook([{ product_id: 'no-es-un-id', amount: 1 }])).rejects.toThrow('invalid_input')
    await expect(cook([], { servings: 2, zone: 'trastero' })).rejects.toThrow('invalid_input')
    await expect(cook([], { servings: 0, zone: 'fridge' })).rejects.toThrow('invalid_amount')

    // Un producto de otra casa, o una casa ajena.
    const other = await createHousehold(db)
    await addEggs(2, null, other)
    const otherEggs = (await productIdByName(other, 'Huevos'))!
    await expect(cook([{ product_id: otherEggs, amount: 1 }])).rejects.toThrow('not_found')
    await expect(rpc(other, 'cook_recipe', { p_house_id: household.houseId, p_title: 'X', p_items: JSON.stringify([{ product_id: eggs, amount: 1 }]) })).rejects.toThrow('not_member')

    // Ya no queda nada de lo que se iba a gastar.
    await rpc(household, 'consume', { p_product_id: eggs, p_all: true })
    await expect(cook([{ product_id: eggs, amount: 1 }])).rejects.toThrow('nothing_to_consume')
    expect(await quantities(otherEggs)).toEqual([])
  })
})

describe('preferencias y Mis datos', () => {
  it('las preferencias tienen un límite de 500 caracteres', async () => {
    const update = (text: string) =>
      asUser(db, household.userId, (tx) => tx.query('update public.profiles set recipe_preferences = $1 where id = $2', [text, household.userId]))
    await update('Sin cilantro. Poca carne roja.')
    await expect(update('x'.repeat(501))).rejects.toThrow()
  })

  it('Mis datos incluye favoritos y bloqueadas, sin el id de usuario', async () => {
    await rpc(household, 'save_recipe_favorite', { p_house_id: household.houseId, p_recipe: JSON.stringify(recipe('Pisto')) })
    await rpc(household, 'block_recipe', { p_title: 'Callos' })
    const data = await rpc<{ recipe_favorites: Record<string, unknown>[]; recipe_blocked: Record<string, unknown>[] }>(household, 'export_my_data')
    expect(data.recipe_favorites).toMatchObject([{ title: 'Pisto', recipe: { title: 'Pisto' } }])
    expect(data.recipe_blocked).toMatchObject([{ title: 'Callos' }])
    expect(data.recipe_favorites[0]).not.toHaveProperty('user_id')
  })

  it('al eliminar la cuenta, se van con ella', async () => {
    const userId = await createUser(db, { display_name: 'Berta' })
    const person = { db, userId }
    await rpc(person, 'block_recipe', { p_title: 'Callos' })
    await rpc(person, 'delete_account')
    const { rows } = await db.query('select 1 from public.recipe_blocked where user_id = $1', [userId])
    expect(rows).toEqual([])
  })
})
