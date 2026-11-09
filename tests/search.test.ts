import { describe, expect, it } from 'vitest'
import { readCatalog } from '../scripts/buildCatalogMigration'
import { createSearch } from '../src/domain/search'

// Se prueba contra el catálogo real, que es donde importa que la búsqueda funcione.
const items = readCatalog().map((item) => ({
  name: item.name_es,
  searchTerms: [item.name_en, ...item.synonyms_es, ...item.synonyms_en],
}))
const search = createSearch(items)
const names = (query: string) => search(query).map((item) => item.name)
const first = (query: string) => names(query)[0]

describe('búsqueda', () => {
  it('criterio de aceptación: "lehce" encuentra Leche', () => {
    expect(names('lehce')).toContain('Leche')
    expect(first('lehce')).toBe('Leche')
  })

  it('tolera erratas', () => {
    expect(first('tomatr')).toBe('Tomates')
    expect(first('zanaoria')).toBe('Zanahorias')
    expect(names('yogurr')).toContain('Yogur natural')
  })

  it('ignora mayúsculas y tildes, en ambos sentidos', () => {
    expect(first('LECHE')).toBe('Leche')
    expect(first('platanos')).toBe('Plátanos')
    expect(first('atun en lata')).toBe('Atún en lata')
    expect(names('cafe')).toContain('Café')
    expect(names('kéfir')).toContain('Kéfir')
  })

  it('ignora plurales simples', () => {
    expect(first('tomate')).toBe('Tomates')
    expect(first('huevo')).toBe('Huevos')
    expect(names('lentejas')).toContain('Lentejas')
    expect(names('lenteja')).toContain('Lentejas')
    expect(names('yogures')).toContain('Yogur natural')
  })

  it('busca en sinónimos', () => {
    expect(names('banana')).toContain('Plátanos')
    expect(names('beicon')).toContain('Bacon')
    expect(names('papas')).toContain('Patatas')
    expect(names('jamón york')).toContain('Jamón cocido')
  })

  it('encuentra por el nombre en el otro idioma', () => {
    expect(names('milk')).toContain('Leche')
    expect(names('chicken')).toContain('Pechuga de pollo')
  })

  it('una palabra corta no trae resultados absurdos', () => {
    const results = names('pan')
    expect(results).toContain('Barra de pan')
    expect(results).toContain('Pan de molde')
    expect(results).not.toContain('Espaguetis')
    expect(results).not.toContain('Patatas')
  })

  it('el nombre pesa más que los sinónimos', () => {
    expect(first('pan de molde')).toBe('Pan de molde')
    expect(first('arroz')).toBe('Arroz')
  })

  it('sin texto devuelve todo', () => {
    expect(search('')).toHaveLength(items.length)
    expect(search('   ')).toHaveLength(items.length)
  })

  it('una errata no trae productos que no se parecen', () => {
    const results = names('lehce')
    expect(results).not.toContain('Mandarinas')
    expect(results).not.toContain('Puerros')
    expect(results.length).toBeLessThan(10)
  })

  it('sin coincidencias no devuelve nada', () => {
    expect(names('zzzzzz')).toEqual([])
  })
})
