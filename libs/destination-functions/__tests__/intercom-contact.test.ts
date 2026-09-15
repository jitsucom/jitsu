import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { testJitsuFunction } from "./lib/testing-lib";
import IntercomDestination from "../src/functions/intercom-destination";
import { IntercomDestinationCredentials } from "../src/meta";

// MSW intercepts the real fetch so we assert on the payload Intercom actually receives.
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const email = "dwight.schrute@dunder-mifflin.com";
const timestamp = "2023-11-28T20:37:14.000Z";
const expectedLastSeenAt = 1701203834;

const identify = {
  type: "identify",
  userId: "user-id-ds",
  traits: { email, name: "Dwight Schrute" },
  timestamp,
  messageId: "7qfgopt6mo22xk2tqs0tb",
  context: {},
} as AnalyticsServerEvent;

// Returns the contact payload sent to Intercom. `existingContact` drives the
// create (POST) vs update (PUT) branch of createOrUpdateContact.
async function captureContactPayload(existingContact?: { id: string }): Promise<any> {
  let captured: any;
  server.use(
    http.post("https://api.intercom.io/contacts/search", () =>
      HttpResponse.json({ data: existingContact ? [existingContact] : [] })
    ),
    http.post("https://api.intercom.io/contacts", async ({ request }) => {
      captured = await request.json();
      return HttpResponse.json({ id: "contact-id" });
    }),
    http.put("https://api.intercom.io/contacts/:id", async ({ request }) => {
      captured = await request.json();
      return HttpResponse.json({ id: "contact-id" });
    })
  );
  await testJitsuFunction<IntercomDestinationCredentials>({
    func: IntercomDestination,
    config: { accessToken: "test-token" } as IntercomDestinationCredentials,
    events: [identify],
  });
  if (captured === undefined) throw new Error("Intercom contact endpoint was never called");
  return captured;
}

test("creating a contact sends last_seen_at as unix seconds", async () => {
  const payload = await captureContactPayload();
  expect(payload.last_seen_at).toBe(expectedLastSeenAt);
  expect(Number.isInteger(payload.last_seen_at)).toBe(true);
});

test("updating a contact sends last_seen_at as unix seconds", async () => {
  const payload = await captureContactPayload({ id: "contact-id" });
  expect(payload.last_seen_at).toBe(expectedLastSeenAt);
  expect(Number.isInteger(payload.last_seen_at)).toBe(true);
});
