---
title: Nuxt.js Guide
---
# Using Jitsu with Nuxt.js

## Install Jitsu

```
yarn add @jitsu/sdk-js
```

## Add Jitsu as a plugin

If you used [Create Nuxt App](https://github.com/nuxt/create-nuxt-app) to build your Nuxt project, your directory structure should look something like this

```
assets/
components/
content/
layouts/
middleware/
pages/
plugins/
...
```

Navigate to the `/plugins` directory inside your Nuxt project and create a new jitsu.js file

```
assets/
components/
content/
layouts/
middleware/
pages/
plugins/
|   jitsu.js
...
```

Inside your `jitsu.js` plugin file you should import jitsu and initialize it

```javascript
const { jitsuClient } = require('@jitsu/sdk-js')
const jitsu = jitsuClient({
  key: "[CLIENT_KEY]",
})

export default (context, inject) => {
  inject('jitsu', jitsu)
}
```

Now you need to add your newly created plugin to you project configuration

```javascript
// nuxt.config.js

  plugins: [
    { src: '~/plugins/jitsu', mode: 'client' },
  ],

```

Make sure the Jitsu plugin is set to [client mode](https://nuxtjs.org/docs/2.x/directory-structure/plugins#client-or-server-side-only) so it doesn't throw an error trying to detect window objects

## Implement Jitsu

Jitsu should now be available globally in your project, here's an example of accessing the jitsu client in a Nuxt page

```html
<template>
    <button @click="trackClick">
        Buy Now
    </button>
</template>

<script>
    methods: {
        trackClick() {
            this.$jitsu.track('buy_button_click', {
                product_id: '1e48fb70-ef12-4ea9-ab10-fd0b910c49ce',
                product_price: 399,
                price_currency: 'USD'
            });
        }
    },
</script>
```
