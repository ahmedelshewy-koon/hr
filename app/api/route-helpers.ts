import { createDatabase, type PostgresDatabase } from "../../db/postgres";
import { apiFailure } from "./api-security";

/**
 * Runs `handler` against a fresh database connection.
 *
 * Every route handler used to repeat the same three concerns by hand: open a
 * connection, translate thrown `Response` objects into a JSON error body, and
 * close the connection in a `finally`. Missing that `finally` leaks a connection
 * for the lifetime of the isolate, so the lifecycle is centralised here.
 *
 * `failureMessage` is the generic message returned for unexpected errors; errors
 * thrown as `Response` keep their own status and message.
 */
export async function withDatabase(
  failureMessage: string,
  handler: (db: PostgresDatabase) => Promise<Response>,
): Promise<Response> {
  const db = createDatabase();
  try {
    return await handler(db);
  } catch (error) {
    return apiFailure(error, failureMessage);
  } finally {
    await db.close();
  }
}
