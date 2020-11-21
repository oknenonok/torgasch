module.exports.timeout = async function(ms) {
  return new Promise(res => setTimeout(res, ms));
};

module.exports.getRoundedPrice = function(minPriceIncrement, price, roundFunction) {
  let priceMultiplier = 1 / minPriceIncrement;
  return +(roundFunction(price * priceMultiplier) / priceMultiplier).toFixed(2);
};

module.exports.formatPrice = function(price) {
  return +price.toFixed(7);
};