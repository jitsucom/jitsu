const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, 'embed.html'), 'utf8');

jest
  .dontMock('fs');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('button', function () {
  beforeEach(() => {
    document.documentElement.innerHTML = html.toString();
  });

  afterEach(() => {
    // restore the original func after test
    jest.resetModules();
  });

  it('button exists', async function () {
    console.log("Sleeping for 2s")
    await sleep(2000)
    console.log(window.jitsu)
    expect(window.jitsu).toBe(undefined);
  });
});