## Available Scripts

**Note**: DO NOT USE NPM!

- `pnpm build:openapi` - generate OpenAPI model definitions
- `pnpm dev` - start the UI dev server; The script will open `localhost:9876` in a new tab of your default browser.
- `pnpm stats` - create a production build that can be further picked by bundle analyzers
- `pnpm analyze` - analyze the bundle using `source-map-explorer` which [is a recommended tool for CRA](https://create-react-app.dev/docs/analyzing-the-bundle-size/)
- `pnpm bundle` - analyze the bundle using `webpack-bundle-analyzer` which has better UI but [may fail to represent tree-shaking](https://github.com/webpack-contrib/webpack-bundle-analyzer/issues/161); for more info, refer to [this discussion](https://github.com/facebook/create-react-app/issues/4563)

Please, do **not** run the following commands. Refer to the `README.md` in the `frontend` folder instead.

- `pnpm install`
- `pnpm start`
- `pnpm build`
