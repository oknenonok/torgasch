const { formatPrice } = require('../funcs');

module.exports.run = async function(api, client, bot, logger, args) {
  try {
    if (args.length !== 2) {
      throw new Error('Required params: fromDate toDate');
    }
    let operations = await api.operations({ from: (new Date(args[0])).toISOString(), to: (new Date(args[1])).toISOString() });
    operations = operations.operations.filter(op => op.status === 'Done' && (op.operationType === 'Buy' || op.operationType === 'Sell') && op.price);
    let stats = {};
    operations.forEach(operation => {
      if (!stats[operation.figi]) {
        stats[operation.figi] = {
          sum: 0,
          quantity: 0,
          operations: 0,
        };
      }
      stats[operation.figi].sum += operation.payment + (operation.commission ? operation.commission.value : 0);
      stats[operation.figi].quantity += operation.quantityExecuted * (operation.operationType === 'Buy' ? -1 : 1);
      stats[operation.figi].operations++;
    });
    let total = 0;
    for (const figi of Object.keys(stats)) {
      if (!stats[figi].quantity) {
        const { ticker } = await api.searchOne({ figi });
        console.log(`${ticker}: ${formatPrice(stats[figi].sum)}`);
        total += stats[figi].sum;
      }
    }
    console.log(`Total: ${formatPrice(total)}`);
  } catch(e) {
    logger.error(e);
  }
};