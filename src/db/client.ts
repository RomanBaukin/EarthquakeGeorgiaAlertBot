import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Database } from "./schema";

export type Db = Kysely<Database>;

export function createDb(binding: D1Database): Db {
  return new Kysely<Database>({ dialect: new D1Dialect({ database: binding }) });
}
