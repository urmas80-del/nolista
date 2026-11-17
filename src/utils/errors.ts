type DbError = { code?: string; message: string };

// Postgres error codes returned by Supabase.
const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501'; // includes "violates row-level security policy"
const RAISED_EXCEPTION = 'P0001'; // our own `raise exception` messages in triggers/RPCs

/**
 * Turn a Supabase/Postgres error into a sentence a user can act on.
 * Messages we raise ourselves in the database are already written for users,
 * so they are shown as-is. Everything else gets a safe fallback and the raw
 * error goes to the console.
 */
export function friendlyError(error: DbError, context: 'invite' | 'general' = 'general'): string {
  if (error.code === RAISED_EXCEPTION) {
    return error.message;
  }

  console.log('Supabase error:', error.code, error.message);

  if (context === 'invite') {
    if (error.code === UNIQUE_VIOLATION) return 'That person already has a pending invite to this board.';
    if (error.code === INSUFFICIENT_PRIVILEGE) return "You can't send this invite. Only the board's owner can invite people.";
  }

  if (error.code === INSUFFICIENT_PRIVILEGE) return "You don't have permission to do that.";

  return 'Something went wrong. Please try again.';
}
