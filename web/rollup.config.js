import typescript from 'rollup-plugin-typescript';
import { terser } from 'rollup-plugin-terser';
import strip from '@rollup/plugin-strip';
import babel from '@rollup/plugin-babel';
import path from 'path';

/**
 * Generates JS module to re-export tracker plugins
 * @param plugins list of plugin names (e.g. ['ga', 'segment'])
 * @returns string
 */
const pluginsGeneratorPlugin = (plugins) => {
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

const stripLoggerPlugin = strip({
  include: ['**/*.ts', '**/*.js'],
  functions: ['logger.*', 't.logger.*'],
  labels: ['logger'],
});

const typescriptPlugin = typescript({
  allowUnusedLabels: false,
  alwaysStrict: false,
});

/*
const addLogging = (plugin, label) => {
  const origTransform = plugin.transform;

  plugin.transform = function (code, id) {
    console.log(`${label} in:`, id);
    const res = origTransform.apply(this, [code, id])
    console.log(`${label} out:`, res);
    return res;
  }
}

// addLogging(typescriptPlugin, 'ts');
// addLogging(stripLoggerPlugin, 'strip')
*/

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

const availPlugins = ['ga', 'segment'];
const targetDir = 'build';

let browserBuilds = [];
combine(availPlugins).forEach(
  (plugins) => {
    [false, true].forEach( // debug on/off variations
      (verbose) => {
        let pluginChunks = [
          ...(plugins.length === 0 ? ['direct'] : []),
          ...(plugins.length < availPlugins.length ? plugins : []),
        ];
        const file = ['track', ...pluginChunks, ...(verbose ? ['debug'] : [])].join('.');
        browserBuilds.push({
          input: './src/browser.ts',
          plugins: [
            pluginsGeneratorPlugin(plugins),
            typescriptPlugin,
            ...(!verbose ? [stripLoggerPlugin] : []),
            terser({
              output: { comments: false },
            }),
          ],
          output: {
            file: `${targetDir}/${file}.js`,
            format: 'iife',
            sourcemap: verbose,
          },
        })
      }
    )
  }
);

export default [
  ...browserBuilds,
  {
    input: 'src/inline.js',
    output: { file: `${targetDir}/inline.js`, format: 'cjs' },
    plugins: [
      babel({babelHelpers: 'bundled'}),
      terser({
        output: { comments: false },
      }),
    ]
  },
  {
    input: `src/main.ts`,
    plugins: [typescriptPlugin],
    output: [
      { file: `dist/main.esm.js`, format: 'es' },
      { file: `dist/main.cjs.js`, format: 'cjs' },
    ]
  }
];
