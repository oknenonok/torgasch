const env = process.argv[2];
const config = require(`./config.${env}.js`);

const https = require('https');
const fs = require('fs');

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(config.telegram.token);

const OpenAPI = require('@tinkoff/invest-openapi-js-sdk');
const api = new OpenAPI({
  apiURL: config.api.apiURL,
  socketURL: config.api.socketURL,
  secretToken: config.api.secretToken,
});

const log4js = require('log4js');
log4js.configure(config.log4js);
const logger = log4js.getLogger('tickers');

const { closestWorkDay } = require('./calendar.js');
const { timeout } = require('./funcs.js');

async function getPage() {
  return new Promise((resolve, reject) => {
    let data = '';
    https.get('https://www.tinkoff.ru/invest/margin/equities/', (res) => {
      res.on('data', (d) => {
        data += d;
      });
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (e) => {
      reject(e);
    });
  });
}

async function main() {
  try {
    logger.info(`Start loading tickers`);
    const html = await getPage();
    let tickers = html.match(/<tr.*?<\/tr>/gu).map(line => {
      line = line.replace(/<([a-z]+).*?>/gu, '<$1>').match(/<td>.*?<\/td>/gu);
      return line ? line : [];
    }).filter(item => item.length === 4 && item[0].indexOf('Акции') !== -1).filter(item => {
      let liquidtyMatches = item[3].match(/<div>(\d+)/);
      return +liquidtyMatches[1] < 38;
    }).map(item => {
      let nameMatches = item[0].match(/<div>([^<]+)/gu).map(match => match.replace('<div>', ''));
      return {
        ticker: nameMatches[1],
        code: `  '${nameMatches[1]}' /* ${nameMatches[0]} */`,
        volume: 0,
      };
    });
    logger.info(`Loaded ${tickers.length} tickers`);
    for (let i = 0; i < tickers.length; i++) {
      if (config.excludeTickers.indexOf(tickers[i].ticker) !== -1) {
        continue;
      }
      let tickerData = await api.searchOne({ ticker: tickers[i].ticker });
      let startDate = closestWorkDay(3);
      let candles = await api.candlesGet({ figi: tickerData.figi, from: startDate.toISOString(), to: (new Date()).toISOString(), interval: 'day' });
      let candle = candles.candles[candles.candles.length - 1];
      if (candle) {
        tickers[i].currency = tickerData.currency;
        tickers[i].volume = tickerData.lot * candle.v * (candle.o + candle.c) * 0.5;
      }
      await timeout(1000);
    }
    tickers.sort((a, b) => b.volume - a.volume);
    tickers = tickers.filter(ticker => {
      return (ticker.currency === 'RUB' && ticker.volume >= 100000000) || (ticker.currency === 'USD' && ticker.volume >= 50000000);
    });
    if (tickers.length < 30) {
      throw new Error(`Very few tickers: ${tickers.length}`);
    }
    fs.writeFileSync(`${__dirname}/tickers.js`, 'module.exports = [\n' + tickers.map(ticker => ticker.code).join(',\n') + '\n];');
    logger.info(`${tickers.length} tickers ready to use`);
  } catch(e) {
    logger.error(e);
    await bot.sendMessage(config.telegram.chatId, `Load tickers: ${JSON.stringify(e)}`);
    process.exit(2);
  }
}

main();