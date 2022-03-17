# Configurator UI Root

This package contains the Configurator UI core code in the `main` folder and supplementary subpackages.

## Before You Start

Note: run all the following commands in the `frontend` folder.

Before starting the frontend locally or building for production, run
`yarn install && yarn lerna bootstrap`. It will install node modules from `main` and other subpackages to the `frontend` folder and symlink them to subpackages.

## Development

Run `yarn start` in the `frontend` folder to start the UI dev server; The script will open `localhost:3000` in a new tab of your default browser.

### Catalog

Run `yarn catalog:link` then `yarn start`. Your changes in the `frontend/catalog` will live update the UI. Once you are done run `yarn catalog:unlink`.

The `catalog` subpackage will be published on npm once pushed to the `beta`/`master` branches. The jitsu.com landing will consume the latest published version on re-deploy.

### Environment Variables

The UI recognizes following environment variables. Those marked with '\*' **must** be provided
before building the app or running it with `yarn start`.

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
        <td><code>BILLING_API_BASE_URL</code> *</td>
        <td>-</td>
        <td>Billing server address (if billing is enabled)</td>
    </tr>
    <tr>
        <td><code>OAUTH_BACKEND_API_BASE</code> *</td>
        <td>-</td>
        <td>OAuth server address (if oauth is enabled)</td>
    </tr>
</table>

**Note**: for adding new environment varialbles please list them in \_webpack.config.js
(look for `webpack.DefinePlugin`) and in env.js (look for `getClientEnvironment`)

## Available Scripts

**Note**: DO NOT USE NPM!

- `yarn start` - dev application (with hot reload) will be started on [http://localhost:9876](http://localhost:9876)
- `yarn build` - run all checks (see `yarn all:check`) and build production configurator UI, see `main/build/` folder for results
- `yarn build:dev` - build prod configurator UI without checking
- `yarn test` - run tests in all subpackages
- `yarn clean` - remove all node modules and built production files
- `yarn prettier:check` - check all \*.ts|tsx files in all subpackages for compliance with the code formatting rules defined in the `.prettirrc.json` file
- `yarn prettier:fix` - fix all mistakes in \*.ts|tsx files in all subpackages
- `yarn eslint:check` - check all \*.ts|tsx files in all subpackages for compliance with rules defined in the `.eslintrc.json` file
- `yarn eslint:fix` - fix all mistakes in \*.ts|tsx files in all subpackages
- `yarn all:check` - check subpackages with both Prettier and ESLint
- `catalog:link` - symlinks local `catalog` subpackage into the root node_modulesd which enables live UI updates on changes in `frontend/catalog` folder
- `catalog:unlink` - breaks the symlink and installs a static `catalog` package in its current state.
- `lerna:publish` - publish canary versions of public subpackages to npm; So far this command is only used in GitHub CI (see `../../.github/workflows/lerna-ci.yml`) and it will only publish the `catalog` subpackage

### Subpackages

- `main` -- core code of the configurator UI;
- `catalog` -- definitions of the entities such as sources, destinations, API keys, mappings, etc. This subpackage is shared with `jitsu.com` and it is auto-published to npm on pushes to the `beta` branch;

### IDE Setup

#### JetBrains IDE's (IDEA, WebStorm etc) config

There're two ways on how to configure IDEA

1. Configure it to reformat code after saving the file each time:
   ![](https://github.com/jitsucom/eventnative-manager/raw/feature/eslint-formatter/frontend/docs/eslint-fix-enable.png)
2. Import [ESLint setting to internal IDEA formatter](https://www.jetbrains.com/help/idea/eslint.html)

#### VSCode

- It is advisable to enable the format on save feature. VSCode will automatically use Prettier rules defined in the frontend folder once you install the Prettier extension.
- It is convenient to use `Run -> Run without debugging` once defined launch configuration and environment variables in the `.code-workspace` file:
  ```JSON
  "launch": {
    "configurations": [
      {
        "command": "yarn start",
        "name": "Run Jitsu Configuratot UI dev server",
        "request": "launch",
        "type": "node-terminal",
        "env": {
          "NODE_ENV": "development",
          "BACKEND_API_BASE": "http://localhost:8000/configurator/",
        }
      },
      {
        "type": "pwa-chrome",
        "request": "attach",
        "name": "Launch chrome against localhost",
        "url": "http://localhost:9876",
        "webRoot": "${workspaceFolder}"
      }
    ],
  ```

## Troubleshooting

- Make shure that you run the commands in the `frontend` folder. Commands in subpackages will not work properly.
- Remove the node modules and built files by running `yarn clean`

## Notes

- Resolution to `react-error-overlay` of version 6.0.9 in `package.json` is needed to overcome the [CRA issue](https://github.com/facebook/create-react-app/issues/11771#issuecomment-995904234). Feel free to remove the resolution once migrated to `react-scripts` v5.
