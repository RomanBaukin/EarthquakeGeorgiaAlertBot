const {
  Telegraf
} = require('telegraf');
require('dotenv').config();
const text = require('./const');
const link = 'https://ies.iliauni.edu.ge/?page_id=183&lang=en';
const chatID = -1001858418173;
const axios = require('axios');
const jsdom = require("jsdom");
const {
  JSDOM
} = jsdom;
const earthquakes = [];

axios.get(link, {
    headers: {
      "Accept-Encoding": "gzip,deflate,compress"
    }
  })
  .then(function(response) {
    // handle success
    const dom = new JSDOM(response.data);
    const table = dom.window.document.querySelector('.eartquakes-table tbody');

    for (let i = 0; i < 10; i++) {
      const tempObj = {
        time: table.childNodes[i].childNodes[0].textContent,
        magnitude: table.childNodes[i].childNodes[1].textContent,
        depth: table.childNodes[i].childNodes[3].textContent,
        coordinates: table.childNodes[i].childNodes[4].textContent,
        region: table.childNodes[i].childNodes[5].textContent
      };

      earthquakes.push(tempObj);
    }
  })
  .catch(function(error) {
    // handle error
    console.log(error);
  })

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.start((ctx) => ctx.reply(`Привет, ${ctx.message.from.first_name ? ctx.message.from.first_name : 'незнакомец'}!`));
bot.command('behavior_during_earthquakes', (ctx) => ctx.reply(text.behaviorDuringEarthquakes));
bot.command('5_recent_earthquakes', (ctx) => ctx.reply(generationMessage(5)));
bot.command('10_recent_earthquakes', (ctx) => ctx.reply(generationMessage(10)));
bot.help((ctx) => ctx.reply(text.commands));

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

function generationMessage(amountEarthquake) {
  let tempStr = `${amountEarthquake} последних землетрясений\n\n`;

  for (let i = 0; i < amountEarthquake; i++) {
    tempStr += `${earthquakes[i].time} | магнитуда ${earthquakes[i].magnitude} | глубина ${earthquakes[i].depth} | координаты ${earthquakes[i].coordinates} | регион ${earthquakes[i].region}\n\n`;
  }

  return tempStr;
}

function checkLastEarthquake() {
  axios.get(link, {
      headers: {
        "Accept-Encoding": "gzip,deflate,compress"
      }
    })
    .then(function(response) {
      // handle success
      const dom = new JSDOM(response.data);
      const table = dom.window.document.querySelector('.eartquakes-table tbody');

      const lastEarthquake = {
        time: table.childNodes[0].childNodes[0].textContent,
        magnitude: table.childNodes[0].childNodes[1].textContent,
        depth: table.childNodes[0].childNodes[3].textContent,
        coordinates: table.childNodes[0].childNodes[4].textContent,
        region: table.childNodes[0].childNodes[5].textContent
      };

      if (lastEarthquake.time !== earthquakes[0].time) {
        const tempStr = `❗️❗️❗️ Новое землетрясение ❗️❗️❗️\n\n${lastEarthquake.time} | магнитуда ${lastEarthquake.magnitude} | глубина ${lastEarthquake.depth} | координаты ${lastEarthquake.coordinates} | регион ${lastEarthquake.region}`;
        bot.telegram.sendMessage(chatID, tempStr);
        earthquakes.shift(lastEarthquake);
        earthquakes.pop();
      }
    })
    .catch(function(error) {
      // handle error
      console.log(error);
    })
}
setInterval(checkLastEarthquake, 60000);
