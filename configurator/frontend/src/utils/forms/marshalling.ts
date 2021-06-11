import isArray from 'lodash/isArray';
import set from 'lodash/set';

const makeObjectFromFieldsValues = <F = any>(fields: any): F => Object.keys(fields).reduce((accumulator: any, current: string) => {
  const value = fields[current];
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    set(accumulator, current, value === 'null' ? null : value);
  } else if (typeof value === 'object') {
    if (isArray(value)) {
      set(
        accumulator,
        current,
        value.map(f => typeof f === 'object' ? makeObjectFromFieldsValues(f) : f)
      );
    }
  }

  return accumulator;
}, {} as F);

export { makeObjectFromFieldsValues }
