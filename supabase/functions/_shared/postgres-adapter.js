// Shared queries use SQLite's bind notation and unqualified table names.
// Keep the Postgres adapter independent of the pooler's session search path.
const tables = /\b(FROM|JOIN|INTO|UPDATE)\s+(employees|office|clients|tasks|task_sessions|attendance|reminders|auth_sessions|login_limits|work_requests|payments|expenses|push_settings|push_subscriptions|push_deliveries|calendar_feeds)\b/gi;

function postgresStatement(query) {
  let index = 0;
  return query.replace(tables, '$1 concept.$2').replace(/\?/g, () => `$${++index}`);
}

function queries(client) {
  const execute = (statement, ...values) => client.unsafe(postgresStatement(statement), values);
  return {
    get: async (...args) => (await execute(...args))[0],
    all: execute,
    run: execute,
  };
}

export function postgresAdapter(client) {
  return {
    ...queries(client),
    transaction: (callback) => client.begin(async (connection) => {
      // Preserve atomic workflows across concurrent Edge Function instances.
      await connection`SELECT pg_advisory_xact_lock(1877142, 2701)`;
      return callback(queries(connection));
    }),
  };
}

export const numericTypes = {
  integerTotals: { to: 20, from: [20, 1700], parse: Number, serialize: String },
};
