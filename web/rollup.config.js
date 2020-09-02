import typescript from 'rollup-plugin-typescript';
import {terser} from 'rollup-plugin-terser';
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

export default [
    {
        input: './src/browser.ts',
        plugins: [
            pluginsGeneratorPlugin(['ga', 'segment']),
            typescriptPlugin,
            [],
            terser({
                output: {comments: false},
            }),
        ],
        output: {
            file: `build/track.js`,
            format: 'iife',
            sourcemap: false,
        },
    },
    {
        input: 'src/inline.js',
        output: {file: `build/inline.js`, format: 'cjs'},
        plugins: [
            babel({babelHelpers: 'bundled'}),
            terser({
                output: {comments: false},
            }),
        ]
    },
    {
        input: `src/main.ts`,
        plugins: [typescriptPlugin],
        output: [
            {file: `dist/main.esm.js`, format: 'es'},
            {file: `dist/main.cjs.js`, format: 'cjs'},
        ]
    }
];
