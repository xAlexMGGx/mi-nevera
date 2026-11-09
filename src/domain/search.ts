import Fuse, { type IFuseOptions } from 'fuse.js'

export interface Searchable {
  name: string
  searchTerms: string[]
}

// Las palabras muy cortas se buscan tal cual: "pan" no debe encontrar "esPAGuetis".
const shortQueryLength = 3

function fuseOptions<T>(threshold: number) {
  return {
    keys: [
      { name: 'name', weight: 2 },
      { name: 'searchTerms', weight: 1 },
    ],
    threshold,
    ignoreLocation: true,
    ignoreDiacritics: true,
  } satisfies IFuseOptions<T>
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** "lehce" -> lhece, elhce, leche, lehec: la errata más común es intercambiar dos letras. */
function withSwappedLetters(text: string): string[] {
  const variants = [text]
  for (let i = 0; i < text.length - 1; i++) {
    variants.push(text.slice(0, i) + text[i + 1] + text[i] + text.slice(i + 2))
  }
  return variants
}

/** Búsqueda difusa (SPEC §6.1): ignora tildes y mayúsculas, y tolera erratas y plurales simples. */
export function createSearch<T extends Searchable>(items: readonly T[]) {
  const fuzzy = new Fuse(items, fuseOptions<T>(0.3))
  const exact = new Fuse(items, fuseOptions<T>(0))

  return (query: string): T[] => {
    const text = query.trim()
    if (!text) return [...items]
    if (text.length <= shortQueryLength) return exact.search(text).map((result) => result.item)

    const variants = withSwappedLetters(normalize(text))
    const contains = (term: string) => {
      const normalized = normalize(term)
      return variants.some((variant) => normalized.includes(variant))
    }

    // Primero lo que coincide en el nombre, tal cual o con dos letras intercambiadas; lo más corto, antes.
    const byName = items.filter((item) => contains(item.name)).sort((a, b) => a.name.length - b.name.length)
    const byTerm = items.filter((item) => item.searchTerms.some(contains))
    const similar = fuzzy.search(text).map((result) => result.item)
    return [...new Set([...byName, ...similar, ...byTerm])]
  }
}
