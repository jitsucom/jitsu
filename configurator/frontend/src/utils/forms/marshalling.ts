import isArray from 'lodash/isArray';
import set from 'lodash/set';

const makeObjectFromFieldsValues = <F = any>(fields: any): F => Object.keys(fields).reduce((accumulator: any, current: string) => {
  if (['string', 'number', 'boolean'].includes(typeof fields[current])) {
    set(accumulator, current, fields[current]);
  } else if (typeof fields[current] === 'object') {
    if (isArray(fields[current])) {
      set(
        accumulator,
        current,
        fields[current].map(f => typeof f === 'object' ? makeObjectFromFieldsValues(f) : f)
      );
    }
  }

  return accumulator;
}, {} as F);

export { makeObjectFromFieldsValues }
