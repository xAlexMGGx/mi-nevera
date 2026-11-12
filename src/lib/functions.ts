import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Llama a una Edge Function con la sesión actual. Si responde con error, lanza uno cuyo mensaje es
 * el código que devuelve la función ({ error: 'ai_quota' }), para traducirlo con errorKey.
 */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload: unknown = await (error.context as Response).json().catch(() => null)
      const code = (payload as { error?: unknown } | null)?.error
      throw new Error(typeof code === 'string' ? code : 'unknown')
    }
    throw error
  }
  if (data === null) throw new Error('unknown')
  return data
}
