module.exports.run = async function(api, client, bot, logger, args) {
  await client.connect();
  const res = await client.query(`SELECT * FROM ${config.db.tables.deals} WHERE active=false AND EXTRACT(DAY FROM (NOW() - date_finish)) <= 7`);
  let totals = {};
  let operations = {};
  let commissions = {};
  res.rows.forEach(row => {
    if (!totals[row.currency]) {
      totals[row.currency] = 0;
    }
    if (!commissions[row.currency]) {
      commissions[row.currency] = 0;
    }
    if (!operations[row.currency]) {
      operations[row.currency] = [];
    }
    totals[row.currency] += +row.result_price;
    commissions[row.currency] += +row.commission_price;
    operations[row.currency].push(`${row.ticker}: ${(+row.result_price).toFixed(2)}`);
  });

  let oldDate = new Date();
  oldDate.setUTCDate(oldDate.getUTCDate() - 7);
  let allOperations = await api.operations({ from: oldDate.toISOString(), to: (new Date()).toISOString() });
  let marginCommission = allOperations.operations.reduce((sum, operation) => {
    return sum + (operation.operationType === 'MarginCommission' ? Math.abs(operation.payment) : 0);
  }, 0).toFixed(2);

  await bot.sendMessage(config.telegram.chatId,
    '#Weekly result: ' + Object.keys(totals).map(currency => `${totals[currency].toFixed(2)} ${currency}`).join(', ') + '\n' +
    'Commission: ' + Object.keys(commissions).map(currency => `${commissions[currency].toFixed(2)} ${currency}`).join(', ') + '\n' +
    'Margin commission: ' + marginCommission + ' RUB\n' +
    'Deals:\n' +
    Object.keys(operations).map(currency => currency + ': ' + operations[currency].join(', ')).join('\n')
  );
  process.exit(0);
}
