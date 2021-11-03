const { formatPrice } = require('../funcs');

module.exports.run = async function(api, client, bot, logger, args) {
  try {
    if (args.length < 1 || args.length > 2) {
      throw new Error('Required params: ticker [fromDate]');
    }
    const ticker = args[0];
    const fromDate = (args.length === 2 ? args[1] : '2000-01-01');
    const { figi } = await api.searchOne({ ticker });

    let operations = await api.operations({ figi, from: (new Date(fromDate)).toISOString(), to: (new Date()).toISOString() });
    operations = operations.operations.filter(op => op.status === 'Done' && (op.operationType === 'Buy' || op.operationType === 'Sell') && op.price);
    let total = 0;
    operations.forEach(operation => {
      total += operation.payment + (operation.commission ? operation.commission.value : 0);
    });

    let portfolio = await api.portfolio();
    const { balance } = portfolio.positions.filter(pos => pos.ticker === ticker).shift();
    console.log(`No-loss price for ${args[0]}: ${formatPrice(-total / balance)}`);
  } catch(e) {
    logger.error(e);
  }
};