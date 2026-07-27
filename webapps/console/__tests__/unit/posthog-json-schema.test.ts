import { PosthogDestinationConfig } from "@jitsu/destination-functions/src/meta";
import Ajv from "ajv";
import { describe, expect, test } from "vitest";
import zodToJsonSchema from "zod-to-json-schema";
import { coreDestinationsMap } from "../../lib/schema/destinations";

const validate = new Ajv().compile(zodToJsonSchema(PosthogDestinationConfig));
const config = (host: string) => ({ key: "phc_test", host });

describe("PostHog host JSON Schema", () => {
  test.each(["https://POSTHOG.EXAMPLE.COM", "HTTPS://APP.POSTHOG.COM"])(
    "accepts case-insensitive HTTPS host %s",
    host => {
      expect(validate(config(host))).toBe(true);
    }
  );

  test("enables only the PostHog schema host field metadata", () => {
    expect(coreDestinationsMap.posthog.credentialsUi).toEqual({
      host: {
        editor: "SchemaHostField",
        validationMessages: {
          pattern: "must be a valid domain, for example: app.posthog.com",
        },
      },
    });
  });
});
