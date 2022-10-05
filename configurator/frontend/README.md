# Configurator UI Root

This package contains the Configurator UI core code in the `main` folder and supplementary subpackages.

## Before You Start

Just run `pnpm i`. In case of any problems try `pnpm factory-reset && pnpn i`

## Development

Run `pnpm dev` in the `frontend` folder to start the UI dev server; The script will open `localhost:9876` in a new tab of your default browser.


### Environment Variables

The UI recognizes following environment variables. Those marked with '\*' **must** be provided
before building the app or running it with `pnpm dev`.

<table>
    <tr>
        <td><b>Variable Name</b></td>
        <td><b>Default Value</b></td>
        <td><b>Meaning</b></td>
    </tr>
    <tr>
        <td><code>BACKEND_API_BASE</code> *</td>
        <td>-</td>
        <td>Backend server (without /api/v1 prefix - e.g. https://api.server.com/)</td>
    </tr>
    <tr>
        <td><code>NODE_ENV</code></td>
        <td>production</td>
        <td>Certain features such as debug logging will be enabled only in development mode</td>
    </tr>
    <tr> 
        <td><code>FIREBASE_CONFIG</code></td>
        <td><code>null</code></td>
        <td>Firebase config JSON. If not specified, Github and Google auth won't be available</td>
    </tr>
    <tr>
        <td><code>ANALYTICS_KEYS</code></td>
        <td><code>{}</code></td>
        <td>Keys for external analytics systems as  JSON</td>
    </tr>
    <tr>
        <td><code>DEV_HOST</code></td>
        <td><code>localhost</code></td>
        <td>Specify a host to use</td>
    </tr>
    <tr>
        <td><code>DEV_PORT</code></td>
        <td><code>9876</code></td>
        <td>Specify a port to use</td>
    </tr>
    <tr>
        <td><code>BILLING_API_BASE_URL</code></td>
        <td>-</td>
        <td>Billing server address (if billing is enabled)</td>
    </tr>
    <tr>
        <td><code>OAUTH_BACKEND_API_BASE</code></td>
        <td>-</td>
        <td>OAuth server address (if oauth is enabled)</td>
    </tr>
</table>

**Note**: for adding new environment variables please list them in \_webpack.config.js
(look for `webpack.DefinePlugin`) and in env.js (look for `getClientEnvironment`)

## Available Scripts

**Note**: DO NOT USE NPM!

- `pnpm dev` - dev application (with hot reload) will be started on [http://localhost:9876](http://localhost:9876)
- `pnpm build` - run all checks (see `pnpm verify`) and build production configurator UI, see `main/build/` folder for results
- (disabled)` pnpm test` - run tests in all subpackages
- `pnpm code-style:check` / `pnpm code-style:fix` - check code style with prettier / fix it 
- `pnpm lint` - run linter
- `canary:publish` - publish canary version of `@jitsu/catalog`. Is used in CI

### Subpackages

- `main` -- core code of the configurator UI;
- `catalog` -- definitions of the entities such as sources, destinations, API keys, mappings, etc. This subpackage is shared with `jitsu.com` and it is auto-published to npm on pushes to the `beta` branch;

## Troubleshooting

- Make sure that you run the commands in the `frontend` folder. Commands in subpackages will not work properly.
- Remove the node modules and built files by running `pnpm factory-reset & pnpm i`

## Notes

- Resolution to `react-error-overlay` of version 6.0.9 in `package.json` is needed to overcome the [CRA issue](https://github.com/facebook/create-react-app/issues/11771#issuecomment-995904234). Feel free to remove the resolution once migrated to `react-scripts` v5.
