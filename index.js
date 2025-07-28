const {
  Telegraf
} = require('telegraf');
require('dotenv').config();
const text = require('./const');
const link = 'https://ies.iliauni.edu.ge/?page_id=183&lang=en';
const chatID = -1001858418173;
const chatIDTEST = -1001776571440;
const axios = require('axios');
const jsdom = require("jsdom");
const {
  JSDOM
} = jsdom;
const bot = new Telegraf(process.env.BOT_TOKEN);
let earthquakes = [];

bot.start((ctx) => ctx.reply(`Привет, ${ctx.message.from.first_name ? ctx.message.from.first_name : 'незнакомец'}!`));
bot.command('behavior_during_earthquakes', async (ctx) => await ctx.reply(text.behaviorDuringEarthquakes));
bot.command('5_recent_earthquakes', async (ctx) => await ctx.reply(generationMessage(5)));
bot.command('10_recent_earthquakes', async (ctx) => await ctx.reply(generationMessage(10)));
bot.help((ctx) => ctx.reply(text.commands));

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

async function generationListEarthquakes() {
  try {
    const response = await axios.get(link, {
      headers: {
        "Accept-Encoding": "gzip,deflate,compress"
      }
    });
    const dom = new JSDOM(response.data);
    const table = dom.window.document.querySelector('.eartquakes-table tbody');

    earthquakes = [];

    if (!table || !table.childNodes || table.childNodes.length === 0) {
      console.log('Table or rows not found');
      return;
    }

    for (let i = 0; i < Math.min(10, table.childNodes.length); i++) {
      const row = table.childNodes[i];
      if (!row || !row.childNodes || row.childNodes.length < 6) continue;
      const tempObj = {
        time: changeTimeToLocal(row.childNodes[0].textContent),
        magnitude: row.childNodes[1].textContent,
        depth: row.childNodes[3].textContent,
        coordinates: row.childNodes[4].textContent,
        region: row.childNodes[5].textContent
      };
      earthquakes.push(tempObj);
    }
  } catch (error) {
    console.log(error);
  }
}

function generationMessage(amountEarthquake) {
  let tempStr = `${amountEarthquake} последних землетрясений\n\n`;
  if (!earthquakes || earthquakes.length === 0) {
    tempStr += 'Нет данных о землетрясениях.';
    return tempStr;
  }
  for (let i = 0; i < amountEarthquake; i++) {
    if (!earthquakes[i]) break;
    tempStr += `${i+1}. ${earthquakes[i].time}\n\nмагнитуда ${earthquakes[i].magnitude} | глубина ${earthquakes[i].depth} км | координаты ${earthquakes[i].coordinates} | регион ${earthquakes[i].region}\n\n\n`;
  }
  return tempStr;
}

async function checkLastEarthquake() {
  try {
    const response = await axios.get(link, {
      headers: {
        "Accept-Encoding": "gzip,deflate,compress"
      }
    });
    const dom = new JSDOM(response.data);
    const table = dom.window.document.querySelector('.eartquakes-table tbody');
    if (!table || !table.childNodes || table.childNodes.length === 0) {
      console.log('Table or rows not found');
      return;
    }
    const row = table.childNodes[0];
    if (!row || !row.childNodes || row.childNodes.length < 6) return;
    const lastEarthquake = {
      time: changeTimeToLocal(row.childNodes[0].textContent),
      magnitude: row.childNodes[1].textContent,
      depth: row.childNodes[3].textContent,
      coordinates: row.childNodes[4].textContent,
      region: row.childNodes[5].textContent
    };
    if (earthquakes.length !== 0 && lastEarthquake.time !== earthquakes[0].time) {
      const tempStr = `❗️❗️❗️ Новое землетрясение ❗️❗️❗️\n\n${lastEarthquake.time}\n\nмагнитуда ${lastEarthquake.magnitude} | глубина ${lastEarthquake.depth} км | координаты ${lastEarthquake.coordinates} | регион ${lastEarthquake.region}`;
      try {
        await bot.telegram.sendMessage(chatID, tempStr);
      } catch (sendError) {
        console.error('Ошибка при отправке сообщения в Telegram:', sendError);
      }
      await generationListEarthquakes();
    }
  } catch (error) {
    console.log(error);
  }
}

function changeTimeToLocal(time) {
  if (!time) return 'Некорректное время';
  const date = new Date(time);
  if (isNaN(date.getTime())) return 'Некорректное время';
  const localTime = new Date(date.getTime() + 14400000);
  return localTime.toString().slice(0, 24);
}

generationListEarthquakes();

setInterval(checkLastEarthquake, 60000);
