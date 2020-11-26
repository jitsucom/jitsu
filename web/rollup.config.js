import replace from '@rollup/plugin-replace';
import typescript from 'rollup-plugin-typescript';
import {terser} from 'rollup-plugin-terser';
import strip from '@rollup/plugin-strip';
import babel from '@rollup/plugin-babel';
import path from 'path';
import copy from 'rollup-plugin-copy'

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
            file: `dist/web/track.js`,
            format: 'iife',
            sourcemap: false,
        },
    },
    {
        input: 'src/inline.js',
        output: {file: `dist/web/inline.js`, format: 'cjs'},
        plugins: [
            babel({babelHelpers: 'bundled'}),
            terser({
                output: {comments: false},
            }),
        ]
    },
    {
        input: `src/main.ts`,
        plugins: [
            typescriptPlugin,
            terser({
                mangle: false,
                module: true,
                keep_classnames: true,
                keep_fnames: true,
                compress: {
                    defaults: false,
                    global_defs: {
                        "@alert": "console.log"
                    }
                },
                //drop_console: true,
                output: {
                    comments: false,
                    beautify: true
                },
            }),
            replace({
                __buildEnv__: 'production',
                __buildDate__: () => new Date().toISOString(),
                __buildVersion__:  process.env['npm_package_version']
            }),
            copy({
                targets: [
                    {src: 'src/types.ts', dest: 'dist/npm', rename: 'main.d.ts'}
                ]
            })
        ],
        output: [
            {file: `dist/npm/main.esm.js`, format: 'es'},
            {file: `dist/npm/main.cjs.js`, format: 'cjs'},
        ]
    }
];
