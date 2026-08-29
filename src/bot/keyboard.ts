import { Keyboard } from "grammy";

export const MENU_BUTTON_LABEL = "☰ Меню";

export const mainReplyKeyboard = new Keyboard().text(MENU_BUTTON_LABEL).resized().persistent();
