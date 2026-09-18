/**
 * The database seam.
 *
 * Production talks to Neon over a WebSocket pool; the tests talk to PGlite, a real
 * PostgreSQL compiled to WASM that runs in-process. Both speak the same SQL, so the
 * repositories below are written once and exercised for real by the test suite -
 * there is no hand-rolled fake to drift from the database.
 *
 * Deliberately tiny: `query` and `transaction` are all the repositories need, and a
 * narrow seam is what keeps swapping the driver honest.
 */

export interface QueryResult<Row> {
  readonly rows: Row[];
  /** Rows the statement actually touched. `markCompleted` depends on this. */
  readonly rowCount: number;
}

export interface SqlClient {
  /**
   * Runs a parameterised statement.
   *
   * `text` is always a literal in the calling code and `params` carries every value.
   * Nothing in this project concatenates user input into SQL.
   */
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;

  /**
   * Runs a script that may contain several statements. Used only by the migration
   * runner - it takes no parameters, so nothing user-supplied can reach it.
   *
   * It lives on the client rather than on `Database` so that a migration and the row
   * recording it land in the SAME transaction.
   */
  exec(sql: string): Promise<void>;
}

export interface Database extends SqlClient {
  /** Runs `fn` inside BEGIN/COMMIT, rolling back if it throws. */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  /** Releases pooled connections. Called by scripts and tests, not by routes. */
  close(): Promise<void>;
}
