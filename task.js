const task = process.argv[2];
const env = process.argv[3];
const fs = require('fs');

if (!fs.existsSync(`./config.${env}.js`)) {
  console.log(`Config ${env} not found`);
  process.exit(0);
}
if (!fs.existsSync(`./tasks/${task}.js`)) {
  console.log(`Task ${task} not found`);
  process.exit(0);
}
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

const { run } = require(`./tasks/${task}.js`);

const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(config.telegram.token);

const log4js = require('log4js');
log4js.configure({
  appenders: {
    console: { type: 'console' },
    [task]: { type: 'dateFile', filename: `${__dirname}/logs/${task}.log`, alwaysIncludePattern: true, daysToKeep: 60, keepFileExt: true }
  },
  categories: {
    default: { appenders: [ 'console' ], level: 'debug' },
    [task]: { appenders: [ 'console', task ], level: 'debug' },
  }
});
const logger = log4js.getLogger(task);

const { execSync } = require('child_process');
let output = (''+execSync(`ps aux | grep ${task} | grep Sl`)).split('\n').filter(item => item);
if (output.length > 2) {
  logger.info('Process already running');
  process.exit(0);
}

const args = process.argv.slice(4);

run(api, client, bot, logger, args);
