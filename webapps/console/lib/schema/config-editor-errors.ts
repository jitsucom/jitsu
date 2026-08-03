import { RJSFValidationError } from "@rjsf/utils";

export type ValidationMessages = Partial<Record<string, string>>;

type FieldValidationConfig = {
  validationMessages?: ValidationMessages;
};

export function transformConfigErrors(
  errors: RJSFValidationError[],
  fields: Record<string, FieldValidationConfig>
): RJSFValidationError[] {
  return errors.map(error => {
    const fieldName = error.property?.replace(/^\./, "");
    const message = fieldName && error.name ? fields[fieldName]?.validationMessages?.[error.name] : undefined;

    return message
      ? {
          ...error,
          message,
          stack: `${error.property ?? ""} ${message}`.trim(),
        }
      : error;
  });
}
