import replace from '@rollup/plugin-replace';
import typescript from 'rollup-plugin-typescript';
import {terser} from 'rollup-plugin-terser';
import babel from '@rollup/plugin-babel';
import copy from 'rollup-plugin-copy'

const typescriptPlugin = typescript({
    allowUnusedLabels: false,
    alwaysStrict: false,
});


export default [
    {
        input: './src/browser.ts',
        plugins: [
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
        input: './src/browser.ts',
        plugins: [
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
