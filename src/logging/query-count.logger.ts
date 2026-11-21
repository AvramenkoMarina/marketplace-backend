import {
  AbstractLogger,
  type LogLevel,
  type LogMessage,
  type QueryRunner,
} from 'typeorm';

export class QueryCountLogger extends AbstractLogger {
  queries = 0;

  constructor() {
    super(['query']);
  }

  reset(): void {
    this.queries = 0;
  }

  protected writeLog(
    _level: LogLevel,
    logMessage: LogMessage | string | number | (LogMessage | string | number)[],
    _queryRunner?: QueryRunner,
  ): void {
    const messages = Array.isArray(logMessage) ? logMessage : [logMessage];
    for (const message of messages) {
      if (typeof message !== 'object' || message.type !== 'query') {
        continue;
      }
      this.queries += 1;
      console.log(`query: ${message.message}`);
    }
  }
}
