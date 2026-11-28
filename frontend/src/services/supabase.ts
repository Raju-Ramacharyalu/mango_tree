import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in frontend/.env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

/**
 * Fetches all rows from a Supabase query by paging in deterministic chunks,
 * avoiding PostgREST's default 1,000-row API truncation limit.
 * Always include a deterministic `.order('id', { ascending: true })` inside `buildQuery`.
 */
export async function fetchAllRows<T = Record<string, unknown>>(
  buildQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: readonly unknown[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const allRows: T[] = []
  let from = 0
  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await buildQuery(from, to)
    if (error) throw error
    const batch = (data ?? []) as T[]
    allRows.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return allRows
}
