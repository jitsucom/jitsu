// @Services
import ApplicationServices from 'lib/services/ApplicationServices';
// @Utils
import ApiKeyHelper from '@service/ApiKeyHelper';
import { randomId } from '@util/numbers';

export async function createFreeDatabase() {
  const services = ApplicationServices.get();
  const { destinations } = await services.initializeDefaultDestination();
  services.analyticsService.track('create_database');
  let helper = new ApiKeyHelper(services, { destinations });
  await helper.init();
  if (helper.keys.length === 0) {
    const newKey: APIKey = {
      uid: `${services.activeProject.id}.${randomId(5)}`,
      serverAuth: `s2s.${services.activeProject.id}.${randomId(5)}`,
      jsAuth: `js.${services.activeProject.id}.${randomId(5)}`,
      origins: []
    };
    await services.storageService.save('api_keys', { keys: [newKey] }, services.activeProject.id);
    helper = new ApiKeyHelper(services, { destinations, keys: [newKey] })
  }
  if (!helper.hasLinks()) {
    await helper.link();
  }
}