import type { Context } from "grammy";
import type { Db } from "../db/client";

export interface BotContext extends Context {
  db: Db;
  /**
   * Можно ли показать админку. Истинно только в личке: в группе меню видят все
   * участники, и сводка по пользователям уехала бы к ним вместе с кнопкой.
   */
  isAdmin: boolean;
}
