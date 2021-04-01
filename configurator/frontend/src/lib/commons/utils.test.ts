import { IndexedList, numberFormat } from './utils';

test('indexedList', () => {
  let indexedList = new IndexedList<string>((str) => (str.length > 0 ? str[0] : ''));
  indexedList.push('12', '34', '45');
  expect(indexedList.toArray()).toStrictEqual(['12', '34', '45']);
  expect(indexedList.remove('3')).toBeDefined();
  expect(indexedList.toArray()).toStrictEqual(['12', '45']);
  expect(() => indexedList.push('13')).toThrow(Error);
});

test('numberFormat', () => {
  expect(numberFormat(1000)).toBe('1,000');
  expect(numberFormat({})(1000)).toBe('1,000');
  expect(numberFormat()(1000)).toBe('1,000');
});
