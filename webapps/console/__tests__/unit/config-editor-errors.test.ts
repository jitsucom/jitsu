import { RJSFValidationError } from "@rjsf/utils";
import { describe, expect, test } from "vitest";
import { transformConfigErrors } from "../../lib/schema/config-editor-errors";

describe("transformConfigErrors", () => {
  test("replaces a configured validation message and removes the original details from the stack", () => {
    const errors: RJSFValidationError[] = [
      {
        name: "pattern",
        property: ".host",
        message: 'must match pattern "^https://..."',
        stack: '.host must match pattern "^https://..."',
      },
    ];

    const [error] = transformConfigErrors(errors, {
      host: {
        validationMessages: {
          pattern: "must be a valid domain, for example app.posthog.com",
        },
      },
    });

    expect(error.message).toBe("must be a valid domain, for example app.posthog.com");
    expect(error.stack).toBe(".host must be a valid domain, for example app.posthog.com");
  });

  test("preserves errors without a configured replacement", () => {
    const error: RJSFValidationError = {
      name: "required",
      property: ".name",
      message: "is required",
      stack: ".name is required",
    };

    expect(transformConfigErrors([error], {})).toEqual([error]);
  });
});
