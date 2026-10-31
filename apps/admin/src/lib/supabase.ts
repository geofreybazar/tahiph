import { createClient } from '@supabase/supabase-js';

/**
 * Supabase reports a used or expired email link in the URL fragment. Read before the client is
 * created, because the client can clear the fragment while processing it.
 */
export const arrivedWithExpiredLink = /error_code=/.test(
  window.location.hash + window.location.search,
);

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
);
