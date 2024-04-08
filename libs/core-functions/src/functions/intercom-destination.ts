import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { IntercomDestinationCredentials } from "../meta";
import { JsonFetcher, jsonFetcher } from "./lib/json-fetch";
import { isEqual, pick } from "lodash";
import { requireDefined } from "juava";

type ExtendedCtx = FullContext<IntercomDestinationCredentials> & {
  jsonFetch: JsonFetcher;
};

const alwaysUpdate = true;

function nullsToUndefined(obj: any) {
  return Object.entries(obj).reduce((acc, [key, value]) => ({ ...acc, [key]: value === null ? undefined : value }), {});
}

export type IntercomCompany = {
  id: string;
  company_id?: string;
  [key: string]: any;
};

export type IntercomContact = {
  id: string;
  company_id?: string;
};

async function getContactByOurUserId(
  userId: string,
  { jsonFetch, props, log }: ExtendedCtx
): Promise<IntercomContact | undefined> {
  const requestBody = {
    query: {
      field: "external_id",
      operator: "=",
      value: userId,
    },
  };
  //log.info(`Intercom: searching for contact by external_id ${userId}, ${JSON.stringify(requestBody, null, 2)})}`);
  const response = await jsonFetch(`https://api.intercom.io/contacts/search`, {
    headers: {
      Authorization: `Bearer ${props.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: requestBody,
  });
  if (response.data.length === 0) {
    return undefined;
  }
  return response.data[0];
}

async function getCompanyByGroupId(
  groupId: string,
  { jsonFetch, props }: ExtendedCtx
): Promise<IntercomCompany | undefined> {
  try {
    return await jsonFetch(`https://api.intercom.io/companies?company_id=${groupId}`, {
      headers: {
        Authorization: `Bearer ${props.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  } catch (e: any) {
    if (e.responseStatus === 404) {
      return undefined;
    } else {
      throw e;
    }
  }
}

async function createOrUpdateCompany(event: AnalyticsServerEvent, ctx: ExtendedCtx) {
  const { jsonFetch, log, props } = ctx;
  const existingCompany = await getCompanyByGroupId(requireDefined(event.groupId, `Group event has no groupId`), ctx);
  //log.debug(`Intercom: search for company ${event.groupId} returned ${JSON.stringify(existingCompany, null, 2)}`);

  const newCompany = {
    company_id: event.groupId,
    name: event.traits?.name || undefined,
    custom_attributes: {}, // omit(event.traits || {}, "name"),
  };

  if (!existingCompany) {
    log.debug(`Company ${event.groupId} not found, creating a new one:\n${JSON.stringify(newCompany, null, 2)}`);
    const createCompanyResponse = await jsonFetch(`https://api.intercom.io/companies`, {
      headers: {
        Authorization: `Bearer ${props.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: newCompany,
    });
    return createCompanyResponse.id;
  } else {
    const forComparison = {
      ...nullsToUndefined(pick(existingCompany, "name")),
      custom_attributes: {}, // existingCompany.custom_attributes || {},
    };
    if (isEqual(forComparison, newCompany) && !alwaysUpdate) {
      log.debug(`Company ${event.groupId} already exists and is up to date, skipping`);
      return;
    } else {
      log.debug(`Company ${event.groupId} needs to be updated, updating ${JSON.stringify(existingCompany, null, 2)}`);
      await jsonFetch(`https://api.intercom.io/companies/${existingCompany.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${props.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: newCompany,
      });
    }
    return existingCompany.id;
  }
}

function toDate(timestamp?: string | number | Date): Date {
  if (!timestamp) {
    return new Date();
  }
  if (typeof timestamp === "string") {
    return new Date(timestamp);
  } else if (typeof timestamp === "number") {
    return new Date(timestamp);
  } else {
    return timestamp;
  }
}

async function createOrUpdateContact(event: AnalyticsServerEvent, { jsonFetch, log, props }: ExtendedCtx) {
  if (!event.traits?.email) {
    return;
  }
  const existingContact = await jsonFetch(`https://api.intercom.io/contacts/search`, {
    headers: {
      Authorization: `Bearer ${props.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: {
      query: {
        operator: "OR",
        value: [
          {
            field: "email",
            operator: "=",
            value: (event.traits || {}).email,
          },
          ...(event.userId
            ? [
                {
                  field: "external_id",
                  operator: "=",
                  value: event.userId,
                },
              ]
            : []),
        ],
      },
    },
  });
  const newContact = {
    role: "user",
    external_id: event.userId || undefined,
    email: (event.traits || {}).email,
    name:
      event.traits?.name ||
      (event.traits?.firstName && event.traits?.lastName
        ? `${event.traits.firstName} ${event.traits.lastName}`
        : undefined),
    phone: event.traits?.phone,
    custom_attributes: {}, // omit(event.traits || {}, "name", "firstName", "lastName", "phone", "email"),
  };
  if (existingContact.data.length === 0) {
    log.debug(
      `Contact ${(event.traits || {}).email} not found, creating a new one:\n${JSON.stringify(newContact, null, 2)}`
    );
    const createContactResponse = await jsonFetch(`https://api.intercom.io/contacts`, {
      headers: {
        Authorization: `Bearer ${props.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: newContact,
    });
    return createContactResponse.id;
  } else {
    const contact = existingContact.data[0];
    const forComparison = {
      ...nullsToUndefined(pick(contact, "name", "email", "phone", "role", "external_id")),
      custom_attributes: contact.custom_attributes || {},
    } as any;
    if (isEqual(forComparison, newContact) && !alwaysUpdate) {
      log.debug(`Contact ${(event.traits || {}).email} already exists and is up to date, skipping`);
      return;
    } else {
      log.debug(
        `Contact ${(event.traits || {}).email} needs to be updated, updating ${JSON.stringify(newContact, null, 2)}`
      );
      await jsonFetch(`https://api.intercom.io/contacts/${contact.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${props.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: newContact,
        //body: forComparison.external_id ? omit(newContact, "external_id") : newContact,
      });
    }
    return contact.id;
  }
}

const IntercomDestination: JitsuFunction<AnalyticsServerEvent, IntercomDestinationCredentials> = async (event, ctx) => {
  const jsonFetch = jsonFetcher(ctx.fetch, { log: ctx.log, debug: true });
  let intercomContactId: string | undefined;
  let intercomCompanyId: string | undefined;
  if (event.type === "identify") {
    intercomContactId = await createOrUpdateContact(event, { ...ctx, jsonFetch });
  } else if (event.type === "group") {
    intercomCompanyId = await createOrUpdateCompany(event, { ...ctx, jsonFetch });
  }
  if ((event.type === "group" || event.type === "identify") && event.groupId && event.userId) {
    if (!intercomCompanyId) {
      intercomCompanyId = (await getCompanyByGroupId(event.groupId, { ...ctx, jsonFetch }))?.id;
      if (!intercomCompanyId) {
        ctx.log.warn(
          `Intercom company ${event.groupId} not found. It's coming from ${event.type} event. Following .group() call might fix it`
        );
        return;
      }
    }
    if (!intercomContactId) {
      intercomContactId = (await getContactByOurUserId(event.userId, { ...ctx, jsonFetch }))?.id;
      if (!intercomContactId) {
        ctx.log.info(`Intercom contact ${event.userId} not found`);
        return;
      }
    }
    await jsonFetch(`https://api.intercom.io/contacts/${intercomContactId}/companies`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.props.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: {
        id: intercomCompanyId,
      },
    });
  }

  if (event.type !== "identify" && event.type !== "group") {
    const email = event.context?.traits?.email || event.traits?.email;
    const userId = event.userId;
    if (!email && !userId) {
      //doesn't make sense to send event without email or userId, Intercom won't know how to link it to a user
    }
    const intercomEvent = {
      type: "event",
      event_name: event.type === "track" ? event.event : event.type === "page" ? "page-view" : "unknown",
      created_at: Math.round(toDate(event.timestamp).getTime() / 1000),
      user_id: userId || undefined,
      email: email || undefined,
      metadata: { ...event.properties, url: event.context?.page?.url || undefined },
    };
    await jsonFetch(
      `https://api.intercom.io/events`,
      {
        headers: {
          Authorization: `Bearer ${ctx.props.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: intercomEvent,
      },
      { event }
    );
  }
};

export default IntercomDestination;
export { IntercomDestination };
