import i18next, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import es from '../locales/es.json'
import type { Lot, OpenedUnit, Product } from './inventory'
import { formatForInput, formatQuantity, parseAmount, summarize, totalContent } from './quantity'

let tEs: TFunction
let tEn: TFunction

beforeAll(async () => {
  const create = async (lng: string) => {
    const instance = i18next.createInstance()
    await instance.init({ lng, resources: { es: { translation: es }, en: { translation: en } }, interpolation: { escapeValue: false } })
    return instance.t
  }
  tEs = await create('es')
  tEn = await create('en')
})

const brick = { quantity_kind: 'divisible', unit_label: 'brick', bulk_unit: null, content_amount: 1, content_unit: 'l' } as Product
const egg = { quantity_kind: 'count', unit_label: 'egg', bulk_unit: null } as Product
const can = { quantity_kind: 'count', unit_label: 'can', bulk_unit: null } as Product
const serving = { quantity_kind: 'count', unit_label: 'serving', bulk_unit: null } as Product
const tomato = { quantity_kind: 'bulk', unit_label: 'unit', bulk_unit: 'kg' } as Product

const closed = (quantity: number) => ({ quantity, opened_at: null }) as Lot
const openLot = (quantity: number) => ({ quantity, opened_at: '2026-11-01' }) as Lot
const open = (remaining_fraction: number) => ({ remaining_fraction }) as OpenedUnit

// Intl separa el número del signo % con un espacio duro en español.
const clean = (text: string | null) => text?.replaceAll(' ', ' ')

describe('resumen de cantidad (SPEC §6.1)', () => {
  it('"5 bricks + 1 abierto (60 %)"', () => {
    expect(clean(summarize(brick, [closed(5)], [open(0.6)], tEs, 'es-ES'))).toBe('5 bricks + 1 abierto (60 %)')
  })

  it('"12 huevos"', () => {
    expect(summarize(egg, [closed(12)], [], tEs, 'es-ES')).toBe('12 huevos')
  })

  it('"1,2 kg"', () => {
    expect(summarize(tomato, [closed(1.2)], [], tEs, 'es-ES')).toBe('1,2 kg')
  })

  it('"3 raciones" y "1 ración"', () => {
    expect(summarize(serving, [closed(3)], [], tEs, 'es-ES')).toBe('3 raciones')
    expect(summarize(serving, [closed(1)], [], tEs, 'es-ES')).toBe('1 ración')
  })

  it('suma varios lotes', () => {
    expect(summarize(brick, [closed(5), closed(6)], [], tEs, 'es-ES')).toBe('11 bricks')
  })

  it('varias abiertas, en plural', () => {
    expect(clean(summarize(brick, [closed(5)], [open(0.6), open(0.3)], tEs, 'es-ES'))).toBe('5 bricks + 2 abiertos (60 %, 30 %)')
  })

  it('solo abiertas', () => {
    expect(clean(summarize(brick, [closed(0)], [open(1)], tEs, 'es-ES'))).toBe('1 abierto (100 %)')
  })

  it('concuerda en femenino', () => {
    expect(summarize(can, [closed(5), openLot(1)], [], tEs, 'es-ES')).toBe('5 latas + 1 abierta')
  })

  it('a granel abierto lo indica', () => {
    expect(summarize(tomato, [openLot(0.25)], [], tEs, 'es-ES')).toBe('0,25 kg (abierto)')
  })

  it('en inglés', () => {
    expect(summarize(brick, [closed(5)], [open(0.6)], tEn, 'en-GB')).toBe('5 cartons + 1 open (60%)')
    expect(summarize(egg, [closed(1)], [], tEn, 'en-GB')).toBe('1 egg')
    expect(summarize(tomato, [closed(1.2)], [], tEn, 'en-GB')).toBe('1.2 kg')
  })
})

describe('formatQuantity', () => {
  it('una unidad desconocida se muestra tal cual', () => {
    expect(formatQuantity(2, { quantity_kind: 'count', unit_label: 'cajita', bulk_unit: null }, tEs, 'es-ES')).toBe('2 cajita')
  })

  it('una fracción va en plural', () => {
    expect(formatQuantity(1.5, serving, tEs, 'es-ES')).toBe('1,5 raciones')
  })
})

describe('totalContent', () => {
  it('cuenta lo que queda en las abiertas', () => {
    expect(totalContent(brick, [closed(5)], [open(0.6)], tEs, 'es-ES')).toBe('5,6 l')
  })

  it('no aplica a otros tipos', () => {
    expect(totalContent(egg, [closed(5)], [], tEs, 'es-ES')).toBeNull()
  })
})

describe('formatForInput', () => {
  it('lo que se precarga en un campo se vuelve a leer igual, también con miles', () => {
    for (const value of [12000, 1500, 1.2, 0.25, 3]) {
      expect(parseAmount(formatForInput(value, 'es-ES'))).toBe(value)
      expect(parseAmount(formatForInput(value, 'en-GB'))).toBe(value)
    }
  })
})

describe('parseAmount', () => {
  it('acepta coma y punto', () => {
    expect(parseAmount('1,2')).toBe(1.2)
    expect(parseAmount('1.2')).toBe(1.2)
    expect(parseAmount(' 3 ')).toBe(3)
    expect(parseAmount('0')).toBe(0)
  })

  it('rechaza lo que no es un número', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('1,2,3')).toBeNull()
  })
})
