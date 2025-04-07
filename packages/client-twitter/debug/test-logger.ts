import { Logger } from '../packages/client-twitter/src/settings';

async function start() {
  Logger.info('Starting test-logger');
  Logger.warn('Starting test-logger');
  Logger.debug('Starting test-logger');
  Logger.info({ '1': 1 }, 'Starting test-logger', { '2': 2 });
  Logger.info('Starting test-logger', '123', { '1': 1 });

  Logger.child({ name: 'twitter11' }).info('Starting test-logger');
}

start().then(console.log).catch(console.error);
