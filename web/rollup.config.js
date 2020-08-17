import { terser } from 'rollup-plugin-terser';
import babel from 'rollup-plugin-babel';

export default [
  {
    input: `src/track.js`,
    output: [
      { file: `build/track.esm.js`, format: 'es' },
      { file: 'build/track.cjs.js', format: 'cjs' },
    ]
  },
  {
    input: `src/track.js`,
    plugins: [
      babel(),
      terser()
    ],
    output: [
      { file: 'build/track.js', format: 'iife' },
    ]
  },
];
