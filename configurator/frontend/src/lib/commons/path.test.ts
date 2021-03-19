import { RoutePath } from './path';

test('testPathParsing', () => {
  let parsed = new RoutePath('/#/page/?param1=2&param2=&param3');
  expect(parsed.path).toBe('page');
  expect(parsed.params['param1']).toBe('2');
  expect(parsed.params['param2']).toBe(null);
  expect(parsed.params['param3']).toBe(true);

  let parsed2 = new RoutePath('/#/?param1=2&param2=&param3');
  expect(parsed2.path).toBe('');

  let parsed3 = new RoutePath('?param1=2&param2=&param3');
  expect(parsed3.path).toBe('');

  let parsed4 = new RoutePath('?');
  expect(parsed4.path).toBe('');
});
