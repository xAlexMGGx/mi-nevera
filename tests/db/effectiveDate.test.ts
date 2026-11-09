import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb } from './harness'

interface Case {
  name: string
  printed?: [string, 'expiry' | 'best_before']
  reminder?: string
  frozen?: string
  thawed?: string
  open?: boolean
  dish?: boolean
  expected: [string | null, string | null]
}

// SPEC §7.2, una fila por regla.
const cases: Case[] = [
  { name: 'cerrado: la fecha impresa', printed: ['2026-12-01', 'expiry'], expected: ['2026-12-01', 'expiry'] },
  { name: 'cerrado: conserva el tipo consumo preferente', printed: ['2026-12-01', 'best_before'], expected: ['2026-12-01', 'best_before'] },
  { name: 'cerrado: sin fecha', expected: [null, null] },
  { name: 'cerrado: ignora una fecha de aviso', printed: ['2026-12-01', 'expiry'], reminder: '2026-11-20', expected: ['2026-12-01', 'expiry'] },

  { name: 'abierto sin aviso: la impresa', open: true, printed: ['2026-12-01', 'expiry'], expected: ['2026-12-01', 'expiry'] },
  { name: 'abierto con aviso anterior a la caducidad: el aviso', open: true, printed: ['2026-12-01', 'expiry'], reminder: '2026-11-20', expected: ['2026-11-20', 'reminder'] },
  { name: 'abierto con aviso posterior a la caducidad: manda la caducidad', open: true, printed: ['2026-11-15', 'expiry'], reminder: '2026-11-20', expected: ['2026-11-15', 'expiry'] },
  { name: 'abierto con aviso posterior al consumo preferente: el aviso', open: true, printed: ['2026-11-15', 'best_before'], reminder: '2026-11-20', expected: ['2026-11-20', 'reminder'] },
  { name: 'abierto sin fecha impresa: el aviso', open: true, reminder: '2026-11-20', expected: ['2026-11-20', 'reminder'] },

  { name: 'congelado sin aviso: sin fecha, aunque tenga impresa', frozen: '2026-10-01', printed: ['2026-10-15', 'expiry'], expected: [null, null] },
  { name: 'congelado con aviso: el aviso', frozen: '2026-10-01', printed: ['2026-10-15', 'expiry'], reminder: '2027-01-01', expected: ['2027-01-01', 'reminder'] },
  { name: 'congelado y abierto: manda estar congelado', frozen: '2026-10-01', open: true, printed: ['2026-10-15', 'expiry'], expected: [null, null] },

  { name: 'descongelado sin aviso: la impresa', frozen: '2026-10-01', thawed: '2026-11-01', printed: ['2026-10-15', 'expiry'], expected: ['2026-10-15', 'expiry'] },
  { name: 'descongelado con aviso: el aviso, aunque la caducidad sea anterior', frozen: '2026-10-01', thawed: '2026-11-01', printed: ['2026-10-15', 'expiry'], reminder: '2026-11-03', expected: ['2026-11-03', 'reminder'] },

  { name: 'táper con aviso: el aviso', dish: true, reminder: '2026-11-20', expected: ['2026-11-20', 'reminder'] },
  { name: 'táper sin aviso: sin fecha', dish: true, expected: [null, null] },
]

describe('fecha efectiva', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await createTestDb()
  })

  it.each(cases)('$name', async ({ printed, reminder, frozen, thawed, open, dish, expected }) => {
    const { rows } = await db.query<{ date: string | null; basis: string | null }>(
      `select effective_date::text as date, effective_basis as basis
       from private.compute_effective($1::date, $2::public.printed_date_type, $3::date, $4::date, $5::date, $6, $7)`,
      [printed?.[0] ?? null, printed?.[1] ?? null, reminder ?? null, frozen ?? null, thawed ?? null, open ?? false, dish ?? false],
    )
    expect([rows[0]?.date ?? null, rows[0]?.basis ?? null]).toEqual(expected)
  })
})
