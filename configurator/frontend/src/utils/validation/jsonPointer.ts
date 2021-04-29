const isValidJsonPointer = (val: string = '') => val.length > 0 && val[0] === '/' && val[val.length - 1] !== '/' && val.indexOf(' ') < 0;

const jsonPointerValidator = () => ({
  validator: (rule, value) => isValidJsonPointer(value)
    ? Promise.resolve()
    : Promise.reject('Invalid JSON pointer syntax. Should be /path/to/element')
});

export { jsonPointerValidator };
