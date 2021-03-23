import ApplicationServices from '../../lib/services/ApplicationServices';
import { ENV } from '../../constants/env';

class Logger {
  private readonly services: ApplicationServices;

  private readonly _appEnvironment: AppEnvironmentType;

  constructor() {
    this.services = ApplicationServices.get();
    this._appEnvironment = (this.services.applicationConfiguration?.rawConfig?.env?.NODE_ENV || ENV.PRODUCTION).toLowerCase() as AppEnvironmentType;
  }

  private isTurnOn() {
    return this._appEnvironment !== ENV.PRODUCTION && !!window.console;
  }

  log(message: any) {
    this.isTurnOn() && console.log(message);
  }

  error(message: any) {
    this.isTurnOn() && console.error(message);
  }

  warn(message: any) {
    this.isTurnOn() && console.warn(message);
  }

  info(message: any) {
    this.isTurnOn() && console.info(message);
  }

  trace(message: any) {
    this.isTurnOn() && console.info(message);
  }
}

const logger = new Logger();

export {
  logger
}
