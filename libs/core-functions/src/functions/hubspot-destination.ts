import type { FullContext, FunctionLogger, JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { HubspotCredentials } from "../meta";
import { Client } from "@hubspot/api-client";
import {
  PropertyCreateFieldTypeEnum,
  PropertyCreateTypeEnum,
} from "@hubspot/api-client/lib/codegen/crm/properties/models/PropertyCreate";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/contacts/models/Filter";
import { FilterGroup } from "@hubspot/api-client/lib/codegen/crm/contacts/models/FilterGroup";
import omit from "lodash/omit";
import assert from "node:assert";
import { BehavioralEventHttpCompletionRequest } from "@hubspot/api-client/lib/codegen/events/send/models/BehavioralEventHttpCompletionRequest";

const JITSU_USER_ID_PROPERTY = "jitsu_user_id";

const JITSU_GROUP_ID_PROPERTY = "jitsu_group_id";

function splitName(name?: string): [string | undefined, string | undefined] {
  if (!name) {
    return [undefined, undefined];
  }
  const [firstName, ...rest] = name.split(" ");
  return [firstName, rest.join(" ") || undefined];
}

type PropertyOptions = { group?: string; objectType?: string };

class HubspotHelper {
  private client: Client;
  private log: FunctionLogger;

  constructor(client: Client, ctx: FullContext<HubspotCredentials>) {
    this.client = client;
    this.log = ctx.log;
  }

  async checkIfPropertyExists(propertyName: string, opts: PropertyOptions = {}): Promise<boolean> {
    const properties = await this.client.crm.properties.coreApi.getAll(opts.objectType || "contacts");
    return properties.results.some(property => property.name === propertyName);
  }

  async createProperty(propertyName: string, opts: PropertyOptions = {}): Promise<void> {
    await this.client.crm.properties.coreApi.create(opts.objectType || "contacts", {
      name: propertyName,
      label: propertyName,
      type: PropertyCreateTypeEnum.String,
      fieldType: PropertyCreateFieldTypeEnum.Text,
      groupName: opts.group || "contactinformation",
      description: `Custom property, created by Jitsu Integration`,
    });
    this.log.info(`Property '${propertyName}' created successfully.`);
  }

  async ensurePropertyExists(propertyName: string, opts: PropertyOptions = {}): Promise<void> {
    const exists = await this.checkIfPropertyExists(propertyName, opts);
    if (!exists) {
      this.log.info(`Property '${propertyName}' does not exist. Creating...`);
      await this.createProperty(propertyName, opts);
    } else {
      //this.log.debug(`Property '${propertyName}' already exists`);
    }
  }

  async upsertHubspotCompany(c: {
    companyId: string;
    name: string;
    customProps?: Record<string, any>;
    doNotUpdate?: boolean;
  }): Promise<string> {
    const filterGroup: FilterGroup = {
      filters: [
        {
          propertyName: JITSU_GROUP_ID_PROPERTY,
          operator: FilterOperatorEnum.Eq,
          value: c.companyId,
        },
      ],
    };
    const searchResults = await this.client.crm.companies.searchApi.doSearch({
      filterGroups: [filterGroup],
      limit: 10,
      after: "0",
      properties: [],
      sorts: [],
    });

    const companyProperties = {
      properties: {
        name: c.name,
        [JITSU_GROUP_ID_PROPERTY]: c.companyId,
      },
    };

    if (searchResults.results.length > 0) {
      // Contact exists, update it
      const companyId = searchResults.results[0].id;
      if (!c.doNotUpdate) {
        await this.client.crm.companies.basicApi.update(companyId, companyProperties);
      }
      return companyId;
    } else {
      // Contact does not exist, create it
      const { id: companyId } = await this.client.crm.companies.basicApi.create({
        ...companyProperties,
        associations: [],
      });
      return companyId;
    }
  }

  async upsertHubspotContact(u: {
    userId: string;
    name?: string;
    email: string;
    customProps?: Record<string, any>;
  }): Promise<string> {
    const existingContactId = await this.getContactByJitsuId(u.userId, u.email);

    const [fistName, lastName] = splitName(u.name);

    const contactProperties = {
      properties: {
        email: u.email,
        firstname: fistName,
        lastname: lastName,
        [JITSU_USER_ID_PROPERTY]: u.userId,
      },
    };

    if (existingContactId) {
      // Contact exists, update it
      await this.client.crm.contacts.basicApi.update(existingContactId, contactProperties);
      return existingContactId;
    } else {
      // Contact does not exist, create it
      const { id: contactId } = await this.client.crm.contacts.basicApi.create({
        ...contactProperties,
        associations: [],
      });
      return contactId;
    }
  }

  async associateContactWithCompany(contactId: string, companyId: string): Promise<void> {
    await this.client.crm.associations.batchApi.create("contacts", "companies", {
      inputs: [
        {
          _from: {
            id: contactId,
          },
          to: {
            id: companyId,
          },
          // The type of association, 2 is the ID for Contact to Company association
          type: "2",
        },
      ],
    });
  }

  async searchContactByField(fieldName: string, fieldValue: string): Promise<string | undefined> {
    const filterGroup: FilterGroup = {
      filters: [
        {
          propertyName: fieldName,
          operator: FilterOperatorEnum.Eq,
          value: fieldValue,
        },
      ],
    };
    const searchResults = await this.client.crm.contacts.searchApi.doSearch({
      filterGroups: [filterGroup],
      limit: 10,
      after: "0",
      properties: [],
      sorts: [],
    });

    return searchResults?.results?.[0]?.id;
  }

  public async getContactByJitsuId(jitsuUserId: string, email?: string): Promise<string | undefined> {
    return (
      (await this.searchContactByField(JITSU_USER_ID_PROPERTY, jitsuUserId)) ||
      (email ? await this.searchContactByField("email", email) : undefined)
    );
  }
}

const HubspotDestination: JitsuFunction<AnalyticsServerEvent, HubspotCredentials> = async (event, ctx) => {
  assert(ctx.props.accessToken);
  const hubspotClient = new Client({ accessToken: ctx.props.accessToken });
  const helper = new HubspotHelper(hubspotClient, ctx);
  await helper.ensurePropertyExists(JITSU_USER_ID_PROPERTY);
  await helper.ensurePropertyExists(JITSU_GROUP_ID_PROPERTY, {
    objectType: "company",
    group: "companyinformation",
  });
  hubspotClient.init();
  let contactId: string | undefined = undefined;
  let companyId: string | undefined = undefined;
  if (event.type === "identify" && event.userId && event.traits.email) {
    contactId = await helper.upsertHubspotContact({
      userId: event.userId,
      name: event.traits.name as string | undefined,
      email: event.traits.email as string,
      customProps: omit(event.traits, "name"),
    });
    if (event.groupId) {
      companyId = await helper.upsertHubspotCompany({
        companyId: event.groupId,
        name: `Company ${event.groupId}`,
        doNotUpdate: true,
      });
    }
  }
  if (event.type === "group" && event.groupId) {
    const groupName = event.type === "group" ? event.traits?.name : undefined;

    await helper.upsertHubspotCompany({
      companyId: event.groupId,
      name: (groupName || `Company ${event.groupId}`) as string | undefined,
      customProps: omit(event.traits, "email", "name"),
    });
    if (event.userId) {
      contactId = await helper.getContactByJitsuId(event.userId);
    }
  }
  if (contactId && companyId) {
    await helper.associateContactWithCompany(contactId, companyId);
  }
  const email = (event.traits?.email || event.properties?.email || undefined) as string | undefined;

  if (email && ctx.props.sendPageViewEvents) {
    const url = event.context?.page?.url || event.properties?.url;
    const properties: Record<string, string> = {};
    if (url) {
      properties.url = url.toString();
    }
    const hubspotEvent: BehavioralEventHttpCompletionRequest = {
      email: email,
      eventName: event.type === "track" ? event.event : event.type,
      objectId: contactId,
      occurredAt: event.timestamp ? new Date(event.timestamp) : new Date(),
      properties: properties,
      uuid: event.messageId,
    };
    await hubspotClient.events.send.behavioralEventsTrackingApi.send(hubspotEvent);
  }
};

export { HubspotDestination };
