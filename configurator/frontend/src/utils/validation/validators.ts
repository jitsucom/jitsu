import { isValidFullIsoDate } from 'utils/validation/date';

const isoDateValidator = (errorMessage: string) => {
  return {
    validator: (rule, value) =>
      !value
        ? Promise.reject(errorMessage)
        : isValidFullIsoDate(value)
        ? Promise.resolve()
        : Promise.reject(
            'Please, fill in correct ISO 8601 date, YYYY-MM-DDThh:mm:ss[.SSS]'
          )
  };
};

export { isoDateValidator };
