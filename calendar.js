const fs = require('fs');

const isHoliday = function(date) {
  const invalidDatesFile = './invalid_dates.txt';
  let isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  if (fs.existsSync(invalidDatesFile)) {
    let strDate = date.toISOString().substr(0, 10);
    let invalidDates = fs.readFileSync(invalidDatesFile).toString().split('\n').map(date => date.trim()).filter(date => date.match(/\d{4}\-\d{2}\-\d{2}/));
    if (invalidDates.indexOf(strDate) !== -1) {
      isWeekend = !isWeekend;
    }
  }
  return isWeekend;
};

module.exports.tradeActiveNow = function() {
  let date = new Date();
  let hour = date.getUTCHours();
  return !isHoliday(date) && hour >= 7 && hour <= 22;
};

module.exports.closestWorkDay = function(daysOffset) {
  let checkDate = new Date();
  let day = checkDate.getUTCDate();
  let daysPassed = 0;
  while (daysPassed < daysOffset) {
    checkDate.setUTCDate(day-1);
    day = checkDate.getUTCDate();
    if (!isHoliday(checkDate)) {
      daysPassed++;
    }
  }
  checkDate.setUTCMinutes(0);
  checkDate.setUTCSeconds(0);
  checkDate.setUTCMilliseconds(0);
  return checkDate;
};
