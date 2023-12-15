import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../../../lib/error-handler";
import { auth } from "../../../../lib/auth";
import { assertTrue, getLog, requireDefined } from "juava";
import { Client, Operators } from "intercom-client";
import { applicationDb, store } from "../../../../lib/services";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  assertTrue(claims.type === "admin", "Only admins can call this API");
  const client = new Client({
    tokenAuth: { token: requireDefined(process.env.INTERCOM_TOKEN, "INTERCOM_TOKEN env variable is not defined") },
  });
  const lookbackDays = req.query.lookbackDays ? parseInt(req.query.lookbackDays as string) : 30;
  const result = await applicationDb.query(
    `select * from newjitsu."IntercomEventsExport" where timestamp > now() - interval '${lookbackDays} day'`
  );
  getLog().atInfo().log(`Found ${result.rowCount} events to export to Intercom`);
  let alreadySent = 0;
  let newEvents = 0;
  let invalidEvents = 0;
  for (const { messageId, timestamp, email, eventName } of result.rows) {
    const sentEventsTable = store.getTable("intercom-events:sent");
    const sentEvents = (await sentEventsTable.get(email as string)) || { eventIds: [] };
    if (sentEvents.eventIds.includes(messageId as string)) {
      getLog().atInfo().log(`Event ${messageId} was already sent to Intercom`);
      alreadySent++;
    } else {
      getLog().atInfo().log(`Sending event ${eventName} from ${email} to Intercom. Date: ${timestamp.toISOString()}`);
      const searchResult = await client.contacts.search({
        data: {
          query: {
            field: "email",
            operator: Operators.EQUALS,
            value: email as string,
          },
        },
      });
      if (searchResult.data.length === 0) {
        getLog().atInfo().log(`Contact ${email} not found in Intercom. Skipping event`);
        invalidEvents++;
        continue;
      } else if (searchResult.data.length > 1) {
        getLog().atInfo().log(`Contact ${email} has ${searchResult.data.length} in Intercom, taking the first one`);
      }
      const intercomUserId = searchResult.data.map(d => d.id).find(id => id !== undefined);
      if (!intercomUserId) {
        getLog().atInfo().log(`Non of ${searchResult.data.length} contacts attached to ${email} doesn't have id`);
        invalidEvents++;
        continue;
      }
      await client.events.create({
        eventName: eventName as string,
        createdAt: Math.round((timestamp as Date).getTime() / 1000),
        id: intercomUserId,
      });
      sentEvents.eventIds.push(messageId);
      await sentEventsTable.put(email as string, sentEvents);
    }
  }
  const apiResponse = { ok: true, alreadySent, newEvents, invalidEvents };
  getLog()
    .atInfo()
    .log(`Result: ${JSON.stringify(apiResponse, null, 2)}`);
  return apiResponse;
};

export default withErrorHandler(handler);
