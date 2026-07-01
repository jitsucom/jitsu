import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

// Shared event fixtures for email-client contact destinations (Resend, SendGrid). They share the same
// contact model (keyed by email, audience/list membership managed on identify), so they share one
// canonical event sequence. `targetsTrait` is the per-event trait used to override audiences/lists
// (e.g. "resendAudiences" or "sendgridLists"); its values are audience/list names.
export const TEST_CONTACT_EMAIL = "dwight.schrute@dunder-mifflin.com";
export const TEST_CONTACT_USER_ID = "user-id-ds";

export function emailContactTestEvents(targetsTrait: string): AnalyticsServerEvent[] {
  const email = TEST_CONTACT_EMAIL;
  const userId = TEST_CONTACT_USER_ID;
  return [
    // 1. identify: create the contact, store traits as properties/fields, add it to targets A + B
    //    (by name; the ones that don't exist are auto-created).
    {
      type: "identify",
      userId,
      anonymousId: "anon-ds",
      traits: {
        email,
        firstName: "Dwight",
        lastName: "Schrute",
        title: "Assistant to the Regional Manager",
        plan: "beets",
        [targetsTrait]: "__TEST, __TEST_B",
      },
      timestamp: "2023-11-28T20:37:14.693Z",
      messageId: "msg-1",
      context: {},
      receivedAt: "2023-11-28T20:37:14.799Z",
    },
    // 2. reconciliation: targets B + C. The contact is removed from __TEST, kept in __TEST_B, and added
    //    to __TEST_C. Also updates a changed trait (and must not create a duplicate contact).
    {
      type: "identify",
      userId,
      traits: {
        email,
        firstName: "Dwight",
        lastName: "Schrute",
        plan: "manager",
        [targetsTrait]: "__TEST_B, __TEST_C",
      },
      timestamp: "2023-11-28T20:40:00.000Z",
      messageId: "msg-2",
      context: {},
    },
    // 3. enriched track: a custom trait added by a function updates the contact's fields.
    {
      type: "track",
      event: "plan_upgraded",
      properties: { revenue: 99 },
      userId,
      traits: { lastSeenFeature: "beet-farming" },
      timestamp: "2023-11-29T16:55:50.255Z",
      messageId: "msg-3",
      context: { traits: { email } },
    },
    // 4. userId-only track for an unknown user: skipped (unless resolveEmailFromUserId + cache hit).
    {
      type: "track",
      event: "ping",
      properties: {},
      userId: "unknown-user",
      timestamp: "2023-11-29T17:00:00.000Z",
      messageId: "msg-4",
      context: {},
    },
  ] as AnalyticsServerEvent[];
}
