import { FullContext, JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { IntercomCredentials } from "../meta";
import { JsonFetcher, jsonFetcher } from "./lib/json-fetch";

type ExtendedCtx = FullContext<IntercomCredentials> & {
  jsonFetch: JsonFetcher;
};

async function createOrUpdateContact(event: AnalyticsServerEvent, { jsonFetch, log }: ExtendedCtx) {
  const { name, email } = event.context?.traits || {};
  if (!email) {
    return;
  }
  const existingContact = await jsonFetch(`https://api.intercom.io/contacts/search`, {
    body: {
      query: {
        operator: "AND",
        value: [{ field: "email", operator: "=", value: email }],
      },
    },
  });
  log.debug(`Intercom: search for contact ${email} returned ${JSON.stringify(existingContact, null, 2)}`);
}

const IntercomDestination: JitsuFunction<AnalyticsServerEvent, IntercomCredentials> = async (event, ctx) => {
  const jsonFetch = jsonFetcher(ctx.fetch);

  if (event.type === "identify") {
    await createOrUpdateContact(event, { ...ctx, jsonFetch });
  }
};
