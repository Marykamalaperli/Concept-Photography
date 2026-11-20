export function sqliteAdapter(db) {
  const queries = {
    get: (sql, ...values) => db.prepare(sql).get(...values),
    all: (sql, ...values) => db.prepare(sql).all(...values),
    run: (sql, ...values) => db.prepare(sql).run(...values),
  };
  let pending = Promise.resolve();
  function queue(work) {
    const result = pending.then(work);
    pending = result.catch(() => {});
    return result;
  }
  return {
    get: (...args) => queue(() => queries.get(...args)),
    all: (...args) => queue(() => queries.all(...args)),
    run: (...args) => queue(() => queries.run(...args)),
    transaction: (callback) => queue(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await callback(queries);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }),
  };
}
