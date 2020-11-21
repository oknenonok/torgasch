const env = process.argv[2];
const config = require(`./config.${env}.js`);

const OpenAPI = require('@tinkoff/invest-openapi-js-sdk');
const api = new OpenAPI({
  apiURL: config.api.apiURL,
  socketURL: config.api.socketURL,
  secretToken: config.api.secretToken,
});

const { Client } = require('pg');
const client = new Client({
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(config.telegram.token);

const log4js = require('log4js');
log4js.configure(config.log4js);
const logger = log4js.getLogger('order');

const { getRoundedPrice, timeout, formatPrice } = require('./funcs.js');

const ticker = process.argv[3];
const operation = process.argv[4];
const limitPrice = +(process.argv[5]);
const isBuy = (operation === 'Buy');
const isSell = (operation === 'Sell');
if (!isBuy && !isSell) {
  logger.error('Invalid operation');
  process.exit(3);
}

const runDate = (new Date()).toISOString();

class NonCriticalError extends Error{};

const waitForExecuteOrder = async function(orderId, props, iteration = 0) {
  let orders;
  try {
    orders = await api.orders();
  } catch (error) {
    logger.error(error);
    return await waitForExecuteOrder(orderId, props, iteration+1);
  }
  logger.debug(orders);
  let stillInQueue = false;
  orders.forEach(order => {
    if (order.orderId === orderId) {
      stillInQueue = true;
    }
  });
  if (stillInQueue) {
    if (props.maxIterations && (iteration >= props.maxIterations)) {
      return false;
    }
    if (props.cancelPrice && props.figi) {
      try {
        let orderBook = await api.orderbookGet({
          depth: 1,
          figi: props.figi,
        });
        let buyPrice = orderBook.asks[0] ? orderBook.asks[0].price : 0;
        if (buyPrice < props.cancelPrice) {
          logger.info(`${operation} ${ticker}: price is less than ${props.cancelPrice}, cancelling`);
          await api.cancelOrder({ orderId });
          return false;
        }
      } catch (error) {
        logger.error(error);
      }
    }
    await timeout(30000);
    return await waitForExecuteOrder(orderId, props, iteration+1);
  }
  return true;
};

const getCurrentQuantityLots = async function(figi) {
  let lots = 0;
  let portfolio = await api.portfolio();
  logger.debug(portfolio);
  portfolio.positions.forEach(position => {
    if (position.figi === figi) {
      lots = position.lots;
    }
  });
  return lots;
};

async function order() {
  let orderPlaced = false;
  await client.connect();
  const dbResult = await client.query(`SELECT * FROM ${config.db.tables.deals} WHERE ticker=$1 AND active=true`, [ticker]);
  let dbRow = dbResult.rows[0];
  if (!dbRow) {
    logger.error(`${operation} ${ticker}: ticker not found in DB`);
    process.exit(2);
  }

  try {
    await client.query(`UPDATE ${config.db.tables.deals} SET date_task=NOW() WHERE id=$1`, [dbRow.id]);

    const quantity = isBuy ? dbRow.rules[dbRow.level-1].quantity : dbRow.quantity;
    logger.info(`${operation} ${quantity} ${ticker} at level ${dbRow.level - 1}`);

    let tickerData = await api.searchOne({ ticker });
    if (!tickerData.lot) {
      logger.debug(tickerData);
      throw new Error('No lot data');
    }
    let orderBook = await api.orderbookGet({
      depth: 1,
      figi: tickerData.figi,
    });
    if (orderBook.tradeStatus !== 'NormalTrading') {
      logger.debug(orderBook);
      process.exit(2);
    }

    const quantityLots = Math.round(quantity / tickerData.lot);
    let currentPrice = orderBook[isSell ? 'bids' : 'asks'][0].price;
    let order;

    if (limitPrice) {
      let oldQuantityLots = await getCurrentQuantityLots(tickerData.figi);
      logger.info(`${operation} ${ticker}: old quantity of lots: ${oldQuantityLots}`);
      let priceMultiplier = 1 / orderBook.minPriceIncrement;
      let orderPrice = +(Math.ceil(limitPrice * priceMultiplier) / priceMultiplier).toFixed(2);
      orderPlaced = true;
      order = await api.limitOrder({ operation: operation, figi: tickerData.figi, lots: quantityLots, price: orderPrice });
      logger.info(`${operation} ${ticker}: placed limit order, price ${orderPrice}`);
      logger.debug(order);
      let waitResult = await waitForExecuteOrder(order.orderId, { cancelPrice: orderPrice*0.996, figi: tickerData.figi });
      if (!waitResult) {
        orderPlaced = false;
        throw new NonCriticalError('Order was cancelled by script');
      }
      let newQuantityLots = await getCurrentQuantityLots(tickerData.figi);
      logger.info(`${operation} ${ticker}: new quantity of lots: ${newQuantityLots}`);
      if (oldQuantityLots === newQuantityLots) {
        orderPlaced = false;
        throw new NonCriticalError('Quantity not changed');
      }
      if (isSell && newQuantityLots > 0) {
        orderPlaced = false;
        let query = `UPDATE ${config.db.tables.deals} SET quantity=${Math.round(newQuantityLots*tickerData.lot)} WHERE id=${dbRow.id}`;
        logger.debug(`Run query ${query}`);
        await client.query(query);
        throw new Error('Quantity not reached zero');
      }
    } else {
      orderPlaced = true;
      order = await api.marketOrder({ operation: operation, figi: tickerData.figi, lots: quantityLots });
      logger.info(`${operation} ${ticker}: placed order, current price ${currentPrice}`);
      logger.debug(order);
      // иногда можно размещать только лимитные заявки
      if (order.status === 'Cancelled' || order.status === 'Rejected') {
        orderBook = await api.orderbookGet({
          depth: 1,
          figi: tickerData.figi,
        });
        currentPrice = orderBook[isSell ? 'bids' : 'asks'][0].price;
        order = await api.limitOrder({ operation: operation, figi: tickerData.figi, lots: quantityLots, price: currentPrice });
        logger.debug(order);
        logger.info(`${operation} ${ticker}: placed limit order, price ${currentPrice}`);
        let orderExecuted = await waitForExecuteOrder(order.orderId, { maxIterations: 500 });
        if (!orderExecuted) {
          await api.cancelOrder({ orderId: order.orderId });
          orderPlaced = false;
          throw new Error('Limit order not executed');
        }
      }
    }
    if (order.status === 'Cancelled') {
      orderPlaced = false;
      throw new Error('Order is cancelled');
    }
    if (order.status === 'Rejected') {
      orderPlaced = false;
      throw new Error('Order is rejected');
    }
    let processedLotCount = 0;
    let operations;
    while (processedLotCount < quantityLots) {
      try {
        operations = await api.operations({ figi: tickerData.figi, from: runDate, to: (new Date()).toISOString() });
      } catch (error) {
        logger.error(error);
      }
      logger.debug(operations);
      if (operations && operations.operations) {
        operations = operations.operations.filter(op => op.status === 'Done' && (op.operationType === 'Buy' || op.operationType === 'Sell') && op.price);
        processedLotCount = operations.reduce((total, operation) => {
          return total + (operation.status === 'Done' ? operation.quantity : 0);
        }, 0);
      }
      await timeout(10000);
    }
    let orderSum = operations.reduce((total, operation) => {
      return total + operation.price * operation.quantity;
    }, 0);
    let orderPrice = orderSum / quantity;
    let initPrice = (dbRow.level === 1 ? orderPrice : dbRow.init_price);
    let allOperations = dbRow.operations ? dbRow.operations : [];
    operations.forEach(operation => {
      allOperations.push(operation);
    });
    let averagePrice = 0;
    let result = 0;
    let commissionPrice = 0;
    let totalQuantity = 0;
    allOperations.forEach(operation => {
      let commission = operation.commission ? Math.abs(operation.commission.value) : 0;
      commissionPrice += commission;
      result -= commission;
      if (operation.operationType === 'Buy') {
        result -= Math.abs(operation.payment);
        averagePrice += Math.abs(operation.payment);
        totalQuantity += operation.quantity;
      } else if (operation.operationType === 'Sell') {
        result += Math.abs(operation.payment);
      }
    });
    averagePrice = averagePrice / totalQuantity;
    let sets = [];
    sets.push(`operations=CAST(ARRAY[${allOperations.map(operation => `'${JSON.stringify(operation)}'`).join(', ')}] as JSON[])`);
    if (dbRow.level === 1) {
      sets.push(`init_price=${formatPrice(initPrice)}`);
      sets.push(`stop_loss_price=${formatPrice(initPrice * (1 - 0.01*config.strategy[dbRow.currency].stopLossPercent))}`);
      sets.push(`date_start=NOW()`);
    }
    if (isSell) {
      sets.push(`active=false`);
      sets.push(`date_finish=NOW()`);
      sets.push(`state='done'`);
    }
    if (isBuy) {
      let nextBuyPrice = dbRow.rules[dbRow.level] ? Math.min(initPrice * (1 - 0.01*dbRow.rules[dbRow.level].percent), 0.985*orderPrice) : 0;
      let takeProfitPrice = averagePrice * (1 + 0.01 * config.strategy[dbRow.currency].rules[dbRow.level-1].takeProfitPercent);
      sets.push(`next_buy_price=${formatPrice(nextBuyPrice)}`);
      sets.push(`quantity=quantity+${quantity}`);
      sets.push(`take_profit_price=${formatPrice(takeProfitPrice)}`);
      sets.push(`state='idle'`);
    }
    sets.push(`average_price=${formatPrice(averagePrice)}`);
    sets.push(`commission_price=${formatPrice(commissionPrice)}`);
    sets.push(`result_price=${formatPrice(result)}`);
    let query = `UPDATE ${config.db.tables.deals} SET ${sets.join(', ')} WHERE id=${dbRow.id}`;
    logger.debug(`Run query ${query}`);
    await client.query(query);
    await client.end();
    await bot.sendMessage(config.telegram.chatId, `${operation} ${quantity} #${ticker} for total ${orderSum.toFixed(2)} ${dbRow.currency}, result: ${result.toFixed(2)}`);
    process.exit(0);

  } catch(e) {
    logger.error(e);
    let query;
    if (isBuy && dbRow && dbRow.level === 1) {
      query = `DELETE FROM ${config.db.tables.deals} WHERE id=${dbRow.id}`;
    } else {
      query = `UPDATE ${config.db.tables.deals} SET state='${orderPlaced ? 'error' : 'idle'}'${isBuy ? ', level=level-1' : ''} WHERE id=${dbRow.id}`;
    }
    logger.debug(`Run query ${query}`);
    await client.query(query);
    await client.end();
    if (!(e instanceof NonCriticalError)) {
      await bot.sendMessage(config.telegram.chatId, `${operation} #${ticker}: ${e.message}`);
    }
    process.exit(2);
  }
}

order();
