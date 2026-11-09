import { describe, expect, it } from 'vitest'
import en from './en.json'
import es from './es.json'

function flatten(value: object, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((all, [key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'string' ? { ...all, [path]: child } : { ...all, ...flatten(child as object, path) }
  }, {})
}

function placeholders(text: string) {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
}

describe('traducciones', () => {
  const flatEs = flatten(es)
  const flatEn = flatten(en)

  it('español e inglés tienen exactamente las mismas claves', () => {
    expect(Object.keys(flatEn).sort()).toEqual(Object.keys(flatEs).sort())
  })

  it('ningún texto está vacío', () => {
    const empty = Object.entries({ ...flatEs, ...flatEn }).filter(([, text]) => !text.trim())
    expect(empty).toEqual([])
  })

  it('cada texto usa las mismas variables en los dos idiomas', () => {
    for (const [key, text] of Object.entries(flatEs)) {
      expect(placeholders(flatEn[key] ?? ''), key).toEqual(placeholders(text))
    }
  })
})
