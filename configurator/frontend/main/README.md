## Available Scripts

**Note**: DO NOT USE NPM!

- `yarn build:openapi` - generate OpenAPI model definitions
- `yarn stats` - create a production build that can be further picked by bundle analyzers
- `yarn explore` - analyze the bundle using `source-map-explorer` which [is a recommended tool for CRA](https://create-react-app.dev/docs/analyzing-the-bundle-size/)
- `yarn bundle` - analyze the bundle using `webpack-bundle-analyzer` which has better UI but [may fail to represent tree-shaking](https://github.com/webpack-contrib/webpack-bundle-analyzer/issues/161); for more info, refer to [this discussion](https://github.com/facebook/create-react-app/issues/4563)
- `yarn prettier:check` - check all \*.ts|tsx files in src directory for compliance
- `yarn prettier:write` - fix all mistakes in \*.ts|tsx files in src directory

Please, do **not** run the following commands. Refer to the `README.md` in the `frontend` folder instead.

- `yarn install`
- `yarn start`
- `yarn build`
