const tickers = require('../tickers');

module.exports.run = async function(api, client, bot, logger, args) {
  logger.info('Start check new falls');
  await client.connect();
  if (config.api.isSandbox) {
    await api.sandboxClear();
    await api.setCurrenciesBalance({ currency: 'RUB', balance: 1000000 });
    await api.setCurrenciesBalance({ currency: 'USD', balance: 10000 });
  }
  let errors = [];

  for (let i = 0; i < tickers.length; i++) {
    let ticker = tickers[i];
    try {
      if (config.excludeTickers.indexOf(ticker) !== -1) {
        logger.info(`ticker ${ticker} is banned`);
        continue;
      }

      const resLimit = await client.query(`SELECT COUNT(id) FROM ${config.db.tables.deals} WHERE active=true`);
      if (+resLimit.rows[0].count >= +config.maxDeals[0]) {
        logger.info(`limit for active tasks already reached`);
        break;
      }

      const resOpLimit = await client.query(`SELECT COUNT(id) FROM ${config.db.tables.deals} WHERE state<>'idle' AND active=true`);
      if (+resOpLimit.rows[0].count >= 4) {
        logger.info(`Active operations limit already reached`);
        break;
      }

      let tickerData = await api.searchOne({ ticker });
      let currency = tickerData.currency;
      if (config.currencies.indexOf(currency) === -1) {
        logger.info(`ticker ${ticker} has unknown currency ${currency}`);
        continue;
      }

      const resExists = await client.query(`SELECT id FROM ${config.db.tables.deals} WHERE ticker=$1 AND active=true`, [ticker]);
      if (resExists.rows.length) {
        logger.info(`ticker ${ticker} already in portfolio`);
        continue;
      }
      const resAlreadyFailed = await client.query(`SELECT id FROM ${config.db.tables.deals} WHERE ticker=$1 AND active=false AND result_price<=0 AND EXTRACT(DAY FROM (NOW() - date_finish)) <= ${config.strategy[currency].daysFall * 4}`, [ticker]);
      if (resAlreadyFailed.rows.length) {
        logger.info(`ticker ${ticker} failed not far from now`);
        continue;
      }
      const resAlreadyBeen = await client.query(`SELECT id FROM ${config.db.tables.deals} WHERE ticker=$1 AND active=false AND EXTRACT(DAY FROM (NOW() - date_finish)) <= ${config.strategy[currency].daysFall}`, [ticker]);
      if (resAlreadyBeen.rows.length) {
        logger.info(`ticker ${ticker} finished not far from now`);
        continue;
      }

      let orderBook = await api.orderbookGet({
        depth: 2,
        figi: tickerData.figi,
      });
      if (orderBook.tradeStatus !== 'NormalTrading') {
        logger.info(`tradeStatus ${ticker} ${orderBook.tradeStatus}`);
        continue;
      }
      let sellPrice = orderBook.bids[1] ? orderBook.bids[1].price : 0;
      let buyPrice = orderBook.asks[1] ? orderBook.asks[1].price : 0;
      if (!sellPrice || !buyPrice) {
        logger.info(`${ticker}: no valid price`);
        continue;
      }
      if (Math.abs(sellPrice - buyPrice) / sellPrice > 0.004) {
        logger.info(`${ticker}: too much gap between bid and ask: ${sellPrice}, ${buyPrice}`);
        continue;
      }

      let startDate = closestWorkDay(config.strategy[currency].daysFall);
      let candles = await api.candlesGet({ figi: tickerData.figi, from: startDate.toISOString(), to: (new Date()).toISOString(), interval: 'hour' });
      candles = candles.candles;
      let enoughFall = false,
          enoughStable = false;
      let high3h = 0,
          low3h = Number.MAX_SAFE_INTEGER,
          highAll = 0,
          lowAll = Number.MAX_SAFE_INTEGER;
      for (let i = candles.length-1; i >= 0; i--) {
        let candle = candles[i];
        if (candle.c > highAll) {
          highAll = candle.c;
        }
        if (candle.c < lowAll) {
          lowAll = candle.c;
        }
        if ((i >= candles.length-3) && (candle.h > high3h)) {
          high3h = candle.h;
        }
        if ((i >= candles.length-3) && (candle.l < low3h)) {
          low3h = candle.l;
        }
      }
      if ((highAll >= sellPrice * (1 + 0.01*config.strategy[currency].initialFallPercent))
              && (highAll <= sellPrice * (1 + 0.01*config.strategy[currency].initialFallPercent*2))
              && (lowAll >= sellPrice * (1 - 0.01*config.strategy[currency].initialFallPercent*0.4))) {
        enoughFall = true;
      }
      if ((high3h <= sellPrice * (1 + 0.01*config.strategy[currency].initialFallPercent*0.2))
              && (low3h >= sellPrice * (1 - 0.01*config.strategy[currency].initialFallPercent*0.2))) {
        enoughStable = true;
      }
      if (sellPrice && enoughFall && enoughStable) {
        let quantity = Math.round(Math.round( config.initialDealPrice[currency] / (sellPrice * tickerData.lot) ) * tickerData.lot);
        if (!quantity) {
          continue;
        }
        const rules = config.strategy[currency].rules.map(rule => {
          return {
            percent: rule.percent,
            quantity: rule.quantity * quantity,
          };
        });
        await client.query(`INSERT INTO ${config.db.tables.deals}
          (ticker, figi, active, level, currency, state, rules, quantity)
          VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
          [ticker, tickerData.figi, true, 1, currency, 'buying', JSON.stringify(rules), 0]
        );
        logger.info(`Proceed to buy ${quantity} ${ticker} at ${sellPrice}`);
        let spawnchild = spawn('node', ['./order.js', env, ticker, 'Buy'], { cwd: __dirname, detached: true, stdio: 'ignore' });
        spawnchild.unref();
      }
    } catch(e) {
      logger.error(e);
      errors.push(e);
    }
    await timeout(1500);
  }
  if (errors.length > 20) {
    await bot.sendMessage(config.telegram.chatId, `Check new: ${errors.length} errors`);
  }
  await client.end();
};
