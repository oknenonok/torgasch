module.exports.run = async function(api, client, bot, logger, args) {
  try {
    await client.connect();
    const res = await client.query(`SELECT * FROM ${config.db.tables.deals} WHERE active=true AND state='idle'`);
    for (let i = 0; i < res.rows.length; i++) {
      let row = res.rows[i];
      let ticker = row.ticker;
      let tickerData = await api.searchOne({ ticker });

      let orderBook = await api.orderbookGet({
        depth: 20,
        figi: row.figi,
      });
      if (orderBook.tradeStatus !== 'NormalTrading') {
        logger.info(`tradeStatus ${ticker} ${orderBook.tradeStatus}`);
        continue;
      }

      let sellPrice = 0;
      let totalQuantity = 0;
      for (let i = 0; i < orderBook.bids.length; i++) {
        if (orderBook.bids[i].price === 0.01) {
          continue;
        }
        totalQuantity += orderBook.bids[i].quantity * tickerData.lot;
        if (totalQuantity >= row.quantity) {
          sellPrice = orderBook.bids[i].price;
          break;
        }
      }

      let buyPrice = 0;
      let quantityForBuy = row.rules[row.level-1] ? row.rules[row.level-1].quantity : 1;
      totalQuantity = 0;
      for (let i = 0; i < orderBook.asks.length; i++) {
        totalQuantity += orderBook.asks[i].quantity * tickerData.lot;
        if (totalQuantity >= quantityForBuy) {
          buyPrice = orderBook.asks[i].price;
          break;
        }
      }

      if (!sellPrice || !buyPrice) {
        logger.info(`${ticker}: no valid price`);
        logger.debug(orderBook);
        continue;
      }
      logger.info(`${ticker}: sellPrice=${sellPrice}, buyPrice=${buyPrice}, take_profit_price=${row.take_profit_price}, next_buy_price=${row.next_buy_price}, stop_loss_price=${row.stop_loss_price}`);

      if (sellPrice && (sellPrice >= row.take_profit_price)) {
        let startDate = new Date();
        startDate.setUTCMinutes(startDate.getUTCMinutes() - 20);
        let candles = await api.candlesGet({ figi: tickerData.figi, from: startDate.toISOString(), to: (new Date()).toISOString(), interval: '5min' });
        candles = candles.candles;
        let lowPrice = Number.MAX_SAFE_INTEGER;
        for (let i = candles.length-1; i >= 0; i--) {
          let candle = candles[i];
          if (candle.l < lowPrice) {
            lowPrice = candle.l;
          }
        }
        if (lowPrice > 0.996 * sellPrice) {
          logger.info(`Proceed to sell ${ticker} at ${sellPrice} with profit`);
          await client.query(`UPDATE ${config.db.tables.deals} SET state='selling' WHERE id=${row.id}`);
          let spawnchild = spawn('node', ['./order.js', env, ticker, 'Sell'], { cwd: __dirname, detached: true, stdio: 'ignore' });
          spawnchild.unref();
        } else {
          logger.error(`Can't sell ${ticker} because last price was too low (${lowPrice} < ${sellPrice})`);
        }
      } else if (sellPrice && (sellPrice <= row.stop_loss_price)) {
        logger.info(`Proceed to sell ${ticker} at ${sellPrice} with loss`);
        await client.query(`UPDATE ${config.db.tables.deals} SET state='selling' WHERE id=${row.id}`);
        let spawnchild = spawn('node', ['./order.js', env, ticker, 'Sell'], { cwd: __dirname, detached: true, stdio: 'ignore' });
        spawnchild.unref();
      } else if (buyPrice && (buyPrice <= row.next_buy_price)) {
        const resLevels = await client.query(`SELECT COUNT(id) FROM ${config.db.tables.deals} WHERE active=true AND level>${row.level}`);
        if (+resLevels.rows[0].count < +config.maxDeals[row.level]) {
          let startDate = new Date();
          startDate.setUTCMinutes(startDate.getUTCMinutes() - 35);
          let candles = await api.candlesGet({ figi: tickerData.figi, from: startDate.toISOString(), to: (new Date()).toISOString(), interval: '5min' });
          candles = candles.candles;
          let highPrice = 0;
          for (let i = candles.length-1; i >= 0; i--) {
            let candle = candles[i];
            if (candle.h > highPrice) {
              highPrice = candle.h;
            }
          }
          if (highPrice < 1.005 * buyPrice) {
            logger.info(`Proceed to buy ${ticker} at ${buyPrice}`);
            await client.query(`UPDATE ${config.db.tables.deals} SET state='buying', level=level+1 WHERE id=${row.id}`);
            let spawnchild = spawn('node', ['./order.js', env, ticker, 'Buy'], { cwd: __dirname, detached: true, stdio: 'ignore' });
            spawnchild.unref();
          } else {
            logger.error(`Can't buy ${ticker} because last price was too high (${highPrice} > ${buyPrice})`);
          }
        } else {
          logger.error(`Can't buy ${ticker} because its level full`);
        }
      } else if (buyPrice && (buyPrice >= row.take_profit_price * 0.998)) {
        let startDate = new Date();
        startDate.setUTCMinutes(startDate.getUTCMinutes() - 35);
        let candles = await api.candlesGet({ figi: tickerData.figi, from: startDate.toISOString(), to: (new Date()).toISOString(), interval: '5min' });
        candles = candles.candles;
        let lowPrice = Number.MAX_SAFE_INTEGER;
        for (let i = candles.length-1; i >= 0; i--) {
          let candle = candles[i];
          if (candle.l < lowPrice) {
            lowPrice = candle.l;
          }
        }
        if (lowPrice > 0.995 * buyPrice) {
          logger.info(`Proceed to sell ${ticker} at ${row.take_profit_price} with profit and limit order`);
          await client.query(`UPDATE ${config.db.tables.deals} SET state='selling' WHERE id=${row.id}`);
          let spawnchild = spawn('node', ['./order.js', env, ticker, 'Sell', row.take_profit_price], { cwd: __dirname, detached: true, stdio: 'ignore' });
          spawnchild.unref();
        } else {
          logger.error(`Can't place sell order for ${ticker} because last price was too low (${lowPrice} < ${buyPrice})`);
        }
      }
    }
    await client.end();
  } catch(e) {
    logger.error(e);
    await bot.sendMessage(config.telegram.chatId, `Check exist: ${JSON.stringify(e)}`);
    process.exit(1);
  }
};
