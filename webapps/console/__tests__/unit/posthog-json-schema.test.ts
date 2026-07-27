import Ajv from "ajv";
import { PosthogDestinationConfig } from "@jitsu/destination-functions/src/meta";
import { coreDestinationsMap } from "../../lib/schema/destinations";
import { describe, expect, test } from "vitest";
import zodToJsonSchema from "zod-to-json-schema";

const validate = new Ajv().compile(zodToJsonSchema(PosthogDestinationConfig));
const config = (host: string) => ({ key: "phc_test", host });

describe("PostHog host JSON Schema", () => {
  test.each(["https://POSTHOG.EXAMPLE.COM", "HTTPS://APP.POSTHOG.COM"])(
    "accepts case-insensitive HTTPS host %s",
    host => {
      expect(validate(config(host))).toBe(true);
    }
  );

  test("enables only the PostHog host editor metadata", () => {
    expect(coreDestinationsMap.posthog.credentialsUi).toEqual({
      host: { editor: "PosthogHostEditor" },
    });
  });
});
