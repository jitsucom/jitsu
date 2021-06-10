import isArray from 'lodash/isArray';
import set from 'lodash/set';

const makeObjectFromFieldsValues = <F = any>(fields: any): F => Object.keys(fields).reduce((accumulator: any, current: string) => {
  const value = fields[current];
  // console.log('Making object', fields)
  // console.log('Setting' + current + '=', value, typeof value);
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    set(accumulator, current, value);
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
