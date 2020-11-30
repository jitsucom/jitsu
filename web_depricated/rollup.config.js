

export default [
    {
        input: `src/eventnative.js`,
        plugins: [
        ],
        output: [
            {file: `dist/eventnative.esm.js`, format: 'es'},
            {file: `dist/eventnative.cjs.js`, format: 'cjs'},
        ]
    }
];
