## Available Scripts

**Note**: DO NOT USE NPM!

- `yarn install` - get all dependencies (run before any script)
- `yarn start` - dev application (with hot reload) will be started on [http://localhost:9876](http://localhost:9876)
- `yarn build` - build prod app, see build/ folder for results
- `yarn add (-D)` - install and add package (-D - optional, use to install devDependency)
- `yarn stats` - create a production build that can be further picked by bundle analyzers
- `yarn explore` - analyze the bundle using `source-map-explorer` which [is a recommended tool for CRA](https://create-react-app.dev/docs/analyzing-the-bundle-size/)
- `yarn bundle` - analyze the bundle using `webpack-bundle-analyzer` which has better UI but [may fail to represent tree-shaking](https://github.com/webpack-contrib/webpack-bundle-analyzer/issues/161); for more info, refer to [this discussion](https://github.com/facebook/create-react-app/issues/4563)
- `yarn prettier:check` - check all \*.ts|tsx files in src directory for compliance
- `yarn prettier:write` - fix all mistakes in \*.ts|tsx files in src directory

## Application configuration

The app recognize following environment variables. Those marked with '\*' **must** be provided
before building the app (or running it with `yarn start`)

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

## Troubleshooting

- `rm -rf yarn.lock ./node_modules && yarn install`

## Initial development setup setup

### ESLint

ESLint helps us to maintain the code style. Please, configure your IDE (or make sure you format code according the config in other way).

#### JetBrains IDE's (IDEA, WebStorm etc) config

There're two ways on how to configure IDEA

1. Configure it to reformat code after saving the file each time:
   ![](https://github.com/jitsucom/eventnative-manager/raw/feature/eslint-formatter/frontend/docs/eslint-fix-enable.png)
2. Import [ESLint setting to internal IDEA formatter](https://www.jetbrains.com/help/idea/eslint.html)
