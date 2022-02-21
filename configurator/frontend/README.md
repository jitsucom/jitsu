# Configurator UI Lerna Root

This package contains the Configurator UI in the `main` folder and supplementary packages in
the `packages` folder.

## Before You Start

Before starting the frontend locally or building for production, run
`yarn install && yarn bootstrap`. It will install node modules in `main` and in all `packages` and
will symlink the packages to main.

## Development

Refer to `README.md` in the `main` folder

### Notes

- Resolution to `react-error-overlay` of version 6.0.9 in `package.json` is needed to overcome the [CRA issue](https://github.com/facebook/create-react-app/issues/11771#issuecomment-995904234). Feel free to remove the resolution once migrated to `react-scripts` v5.
