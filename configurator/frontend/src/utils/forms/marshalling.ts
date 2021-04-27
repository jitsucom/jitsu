import { set } from 'lodash';

const makeObjectFromFieldsValues = <F = object>(fields: any): F => Object.keys(fields).reduce((accumulator: F, current: string) => {
  if (typeof fields[current] !== undefined) {
    set(accumulator, current, fields[current]);
  }

  return accumulator;
}, {} as F);

export { makeObjectFromFieldsValues }
