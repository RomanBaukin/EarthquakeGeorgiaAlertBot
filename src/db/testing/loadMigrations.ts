import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");

// Тестовая SQLite поднимается из боевых миграций целиком, а не из одной первой:
// иначе новая колонка в тесты не попадёт и расхождение миграций со `schema.ts`
// перестанет ловиться — ровно то, ради чего репозитории и тестируются на настоящей БД.
export function loadMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"))
    .join("\n");
}
