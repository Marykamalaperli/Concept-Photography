export function supabaseAdminAuth({ url, apiKey, fetchAuth = fetch }) {
  const tokenUrl = new URL('/auth/v1/token?grant_type=password', url);
  return {
    identity(store, employeeId) {
      return store.get(`
        SELECT employees.auth_user_id, employees.email
        FROM employees
        JOIN auth.users ON auth.users.id = employees.auth_user_id
        WHERE employees.id = ? AND employees.is_admin = 1 AND employees.archived = 0
          AND lower(auth.users.email) = employees.email
          AND auth.users.email_confirmed_at IS NOT NULL AND auth.users.deleted_at IS NULL
          AND (auth.users.banned_until IS NULL OR auth.users.banned_until <= now())
      `, employeeId);
    },

    async authenticate(email, password) {
      const response = await fetchAuth(tokenUrl, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (response.status >= 500 || response.status === 429) {
        await response.body?.cancel();
        throw new Error('Supabase sign-in unavailable.');
      }
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const { user } = await response.json();
      return user?.id ?? null;
    },
  };
}
