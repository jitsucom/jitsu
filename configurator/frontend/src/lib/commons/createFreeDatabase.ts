// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Utils
import ApiKeyHelper from 'lib/services/ApiKeyHelper';

export async function createFreeDatabase() {
  const services = ApplicationServices.get();

  const { destinations } = await services.initializeDefaultDestination();
  const freeDatabaseDestination = destinations[0];

  services.analyticsService.track('create_database');

  const helper = new ApiKeyHelper(services);
  await helper.init();

  let key = helper.keys[0];
  if (!key) {
    key = await helper.createNewAPIKey()
  }

  helper.linkKeyToDestination(key, freeDatabaseDestination);
}