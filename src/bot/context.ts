import type { Context } from "grammy";
import type { Db } from "../db/client";

export interface BotContext extends Context {
  db: Db;
}
