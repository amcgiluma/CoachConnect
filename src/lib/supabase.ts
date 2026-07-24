import { createClient } from '@supabase/supabase-js'
import type { Database } from '../database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const hasSupabase = Boolean(url && key)

export const supabase = createClient<Database>(
  url || 'https://placeholder.supabase.co',
  key || 'sb_publishable_placeholder',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)
