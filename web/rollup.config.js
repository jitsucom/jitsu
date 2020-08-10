import typescript from 'rollup-plugin-typescript';
import { terser } from 'rollup-plugin-terser';
import strip from '@rollup/plugin-strip';
import path from 'path';

/**
 * Generates JS module to re-export tracker plugins
 * @param plugins list of plugin names (e.g. ['ga', 'segment'])
 * @returns string
 */
const pluginsGenerator = (plugins) => {
  const PREFIX = `\0virtual:`;
  const PLUGINS_PATH = 'plugins';
  return {
    name: 'pluginsGenerator',
    resolveId(id, importer) {
      if (id === PLUGINS_PATH) {
        return PREFIX + PLUGINS_PATH;
      }
      if ((importer || '').startsWith(PREFIX)) {
        return path.resolve('./src', id);
      }
    },
    load(id) {
      if (id.startsWith(PREFIX)) {
        return `${plugins.map(p => `import ${p} from './${p}-plugin.ts';`).join("\n")}
                export default [${plugins.map(p => `${p}()`).join(',')}];`;
      }
    }
  };
}

const stripLogger = strip({
  include: ['**/*.ts'],
  functions: ['this.logger.*'],
  labels: ['logger'],
});

/**
 * Create all available combinations of passed array elements,
 * e.g. for [1, 2] returns [[], [1], [2], [1,2]]
 * @param arr
 * @returns {[]}
 */
const combine = arr => {
  const len = arr.length;
  const total = 2 ** len;
  const res = []
  for (let i = 0; i < total; i++) {
    res[i] = [];
    for (let j = 0; j < len; j++) {
      if (i & (2 ** j)) {
        res[i].push(arr[j]);
      }
    }
  }
  return res;
}

const plugins = ['ga', 'segment'];
const targetDir = 'build';

let browserBuilds = [];
combine(plugins).forEach(
  (plugins) => {
    [false, true].forEach( // debug on/off variations
      (verbose) => {
        const file = ['track', ...plugins, ...(verbose ? ['debug'] : [])].join('.');
        browserBuilds.push({
          input: './src/browser.ts',
          plugins: [
            pluginsGenerator(plugins),
            typescript(),
            ...(!verbose ? [stripLogger] : []),
            terser({
              output: { comments: false },
            }),
          ],
          output: {
            file: `${targetDir}/browser/${file}.js`,
            format: 'iife'
          },
        })
      }
    )
  }
);

export default [
  ...browserBuilds,
  ...[
    ['tracker', 'index'],
    ...plugins.map(p => [`${p}-plugin`, `plugins/${p}`])
  ].map(
    ([src, dst]) => ({
      input: `src/${src}.ts`,
      plugins: [typescript()],
      output: { file: `${targetDir}/${dst}.js`, format: 'es' },
    })
  ),
];
