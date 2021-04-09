import { TestServer } from './common';
const rollup = require('rollup');
import loadConfigFile from 'rollup/dist/loadConfigFile';
import path from 'path';

(async function () {
  process.env.NODE_ENV = 'development';

  let rollupFile = `${__dirname}/../../rollup.config.js`;
  console.log(`Loading rollup file ${rollupFile}`);
  const { options, warnings } = await loadConfigFile(path.resolve(rollupFile), { format: 'es' });

  // This prints all deferred warnings
  warnings.flush();

  for (const optionsObj of options) {
    const bundle = await rollup.rollup(optionsObj);
    await Promise.all(optionsObj.output.map(bundle.write));
  }

  // You can also pass this directly to "rollup.watch"
  const watcher = rollup.watch(options);


  watcher.on('event', (event) => {
    if (event.code === 'START') {
      console.log("Building output bundles...")
    } else if (event.code === 'END') {
      console.log("Rollup build completed!")
    }
  });


  let testServer = new TestServer(process.env.PORT ? parseInt(process.env.PORT) : undefined);

  await testServer.init();

})();
