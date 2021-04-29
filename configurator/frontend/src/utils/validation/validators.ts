import { isValidFullIsoDate } from '@util/validation/date';

const requiredValidator = (required: boolean, displayName: string) => (
  { required, message: `${displayName} field is required.` }
);

const isoDateValidator = () => ({
  validator: (rule, value) => isValidFullIsoDate(value)
    ? Promise.resolve()
    : Promise.reject('Please, fill in correct ISO 8601 date, YYYY-MM-DDThh:mm:ss[.SSS]')
});

export { requiredValidator, isoDateValidator };
