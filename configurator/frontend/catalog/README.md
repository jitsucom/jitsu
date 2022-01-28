# `@jitsu/catalog`

This package contains the code that enables variety of features of Jitsu Sources, Destinations and API Keys.

At Jitsu we use it to power the Configurator front-end as well as to generate a part of the documentation at [`jitsu.com`](https://jitsu.com).

## Usage

Just import the needed files from the catalog package.

```JSX
import { allSources } from "./sources/lib"

//...

return (
  <Component>
    {allSources.map(source => <ListItem title={source.name} icon={source.icom}>)}
  </Component>
)
```
