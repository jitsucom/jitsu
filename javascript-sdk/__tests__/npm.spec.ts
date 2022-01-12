import {jitsuClient} from '../src/jitsu'
import {JitsuClient} from '../src/interface'
test('Test Jitsu Client npm only', async () => {
  let fetchMock = jest.mock('node-fetch')
  let jitsu: JitsuClient = jitsuClient({
    fetch: fetchMock,
    key: "Test",
    tracking_host: "https://some-host"
  });
  const req: Request = {}
  const res: Response = {}
  await jitsu.id({
    email: 'a@b.c',
    id: 'someId'
  }, true)

  await jitsu.track('test', {
    req, res
  });
});
