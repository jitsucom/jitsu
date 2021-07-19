// @Libs
import { observable, action } from 'mobx';
// @Services
import ApplicationServices from 'lib/services/ApplicationServices'
// @Model
import { Domain } from 'lib/services/model';
import { isArray } from 'utils/typeCheck';

type DomainsList = Domain[]

export interface ICustomDomainsStore {
  domains: DomainsList;
  certificateExpiration: Date | null;
}

enum DomainsDataStatus {
  IDLE = 'IDLE',
  PULLING = 'PULLING',
  PULLING_FAILED = 'PULLING_FAILED'
}

class CustomDomainsStore implements ICustomDomainsStore {
  private services: ApplicationServices;

  @observable public domains: DomainsList;

  @observable public certificateExpiration: Date | null;

  @observable public domainsDataStatus: DomainsDataStatus = DomainsDataStatus.IDLE;

  constructor() {
    this.services = ApplicationServices.get();
    this.domains = [];
    this.certificateExpiration = null;
  }

  private computeAddDomains(domainsToAdd: Domain | DomainsList): DomainsList {
    if (!isArray(domainsToAdd)) domainsToAdd = [domainsToAdd];
    return [...this.domains, ...domainsToAdd];
  }

  private computeRemoveDomains(_domainsToRemove: Domain | DomainsList) {
    const domainsToRemove: DomainsList = isArray(_domainsToRemove) ? _domainsToRemove : [_domainsToRemove]
    return this.domains.filter(domain => {
      return !domainsToRemove.map(({ name }) => name).includes(domain.name);
    }, []);

  }

  private async fetchDomains(): Promise<ICustomDomainsStore> {
    const result = this.services.storageService.get(
      'custom_domains',
      this.services.activeProject.id
    );
    const expiration = result?.['_certificateExpiration'];
    return {
      domains: result?.['domains'] || [],
      certificateExpiration: expiration?.length > 0
        ? new Date(Date.parse(expiration))
        : null
    };
  }

  private async requestAddDomains(domainsToAdd: Domain | DomainsList): Promise<void> {
    const domains = this.computeAddDomains(domainsToAdd);

    await this.services.storageService.save(
      'custom_domains',
      { domains },
      this.services.activeProject.id
    )
  }

  private async requestRemoveDomains(domainsToRemove: Domain | DomainsList): Promise<void> {
    const domains = this.computeRemoveDomains(domainsToRemove);

    await this.services.storageService.save(
      'custom_domains',
      { domains },
      this.services.activeProject.id
    )
  }

  @action public async pullData() {
    this.domainsDataStatus = DomainsDataStatus.PULLING
    try {
      const result = await this.fetchDomains();
      this.domains = result.domains;
      this.certificateExpiration = result.certificateExpiration;
    } catch (error) {
      this.domainsDataStatus = DomainsDataStatus.PULLING_FAILED
      throw error;
    }
    this.domainsDataStatus = DomainsDataStatus.IDLE
  };

  @action public async addDomain(domain: Domain) {
    try {
      await this.requestAddDomains(domain);
      this.domains = this.computeAddDomains(domain);
    } finally {
      this.domainsDataStatus = DomainsDataStatus.IDLE
    }
  }

  @action public async removeDomain(domain: Domain) {
    try {
      await this.requestRemoveDomains(domain);
      this.domains = this.computeRemoveDomains(domain);
    } finally {
      this.domainsDataStatus = DomainsDataStatus.IDLE
    }
  }
}

export const customDomainsStore = new CustomDomainsStore();