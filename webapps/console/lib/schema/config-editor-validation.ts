import { FormValidation } from "@rjsf/utils";

export type ClientFieldValidator = (value: unknown, formData: Record<string, unknown>) => string | undefined;

type ClientFieldValidationConfig = {
  clientValidator?: ClientFieldValidator;
};

type FieldErrorDisplay = {
  props?: {
    errors?: unknown[];
  };
};

export function hasFieldValidationErrors(errors: FieldErrorDisplay | undefined): boolean {
  return (errors?.props?.errors?.length ?? 0) > 0;
}

export function applyClientFieldValidation<T extends Record<string, unknown>>(
  formData: T | undefined,
  errors: FormValidation<T>,
  fields: Record<string, ClientFieldValidationConfig>
): FormValidation<T> {
  if (!formData) {
    return errors;
  }

  Object.entries(fields).forEach(([fieldName, field]) => {
    const message = field.clientValidator?.(formData[fieldName], formData);
    if (message) {
      errors[fieldName as keyof T]?.addError(message);
    }
  });

  return errors;
}
