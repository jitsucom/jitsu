/******/ (function (modules) {
  // webpackBootstrap
  /******/ // The module cache
  /******/ var installedModules = {};

  /******/ // The require function
  /******/ function __webpack_require__(moduleId) {
    /******/ // Check if module is in cache
    /******/ if (installedModules[moduleId])
      /******/ return installedModules[moduleId].exports;

    /******/ // Create a new module (and put it into the cache)
    /******/ var module = (installedModules[moduleId] = {
      /******/ exports: {},
      /******/ id: moduleId,
      /******/ loaded: false,
      /******/
    });

    /******/ // Execute the module function
    /******/ modules[moduleId].call(
      module.exports,
      module,
      module.exports,
      __webpack_require__
    );

    /******/ // Flag the module as loaded
    /******/ module.loaded = true;

    /******/ // Return the exports of the module
    /******/ return module.exports;
    /******/
  }

  /******/ // expose the modules object (__webpack_modules__)
  /******/ __webpack_require__.m = modules;

  /******/ // expose the module cache
  /******/ __webpack_require__.c = installedModules;

  /******/ // __webpack_public_path__
  /******/ __webpack_require__.p = "";

  /******/ // Load entry module and return exports
  /******/ return __webpack_require__(0);
  /******/
})(
  /************************************************************************/
  /******/ [
    /* 0 */
    /***/ function (module, exports, __webpack_require__) {
      __webpack_require__(1);

      /***/
    },
    /* 1 */
    /***/ function (module, exports, __webpack_require__) {
      /* WEBPACK VAR INJECTION */ (function (global) {
        module.exports = global["fetch"] = __webpack_require__(2);
        /* WEBPACK VAR INJECTION */
      }.call(
        exports,
        (function () {
          return this;
        })()
      ));

      /***/
    },
    /* 2 */
    /***/ function (module, exports, __webpack_require__) {
      /**
       * fetch.js
       *
       * a request API compatible with window.fetch
       */

      var Headers = __webpack_require__(3);

      module.exports = Fetch;

      /**
       * Fetch class
       *
       * @param   Mixed    url   Absolute url or Request instance
       * @param   Object   opts  Fetch options
       * @return  Promise
       */
      function Fetch(url, o) {
        // allow call as function
        if (!(this instanceof Fetch)) return new Fetch(url, o);

        // allow custom promise
        if (!Fetch.Promise) {
          throw new Error(
            "native promise missing, set Fetch.Promise to your favorite alternative"
          );
        }

        if (!url) {
          throw new Error("url parameter missing");
        }

        var options = o || {};

        // wrap http.request into fetch
        return new Fetch.Promise(function (resolve, reject) {
          // normalize headers
          var headers = new Headers(options.headers || {});

          if (!headers.has("user-agent")) {
            headers.set(
              "user-agent",
              "golang-fetch/0.0 (+https://github.com/augustoroman/v8fetch)"
            );
          }

          headers.set("connection", "close");

          if (!headers.has("accept")) {
            headers.set("accept", "*/*");
          }

          options.headers = headers.raw();

          // send a request
          var res = Fetch.goFetchSync(url, JSON.stringify(options));
          res.url = url;

          resolve(new Response(res));
        });
      }

      /**
       * Response class
       *
       * @param   Object  opts  Response options
       * @return  Void
       */
      function Response(r) {
        Object.assign(this, r);
        let h = new Headers();
        for (let [key, values] of Object.entries(r.headers || {})) {
          for (let value of values) {
            h.append(key, value);
          }
        }
        this.headers = h;
        this.ok = this.status >= 200 && this.status < 300;
      }

      /**
       * Decode response as json
       *
       * @return  Promise
       */
      Response.prototype.json = function () {
        return this.text().then(function (text) {
          return JSON.parse(text);
        });
      };

      /**
       * Decode response body as text
       *
       * @return  Promise
       */
      Response.prototype.text = function () {
        return new Fetch.Promise((resolve, reject) => {
          resolve(this.body);
        });
      };

      Fetch.Promise = typeof Promise !== "undefined" ? Promise : undefined;

      /***/
    },
    /* 3 */
    /***/ function (module, exports) {
      /**
       * headers.js
       *
       * Headers class offers convenient helpers
       */

      module.exports = Headers;

      /**
       * Headers class
       *
       * @param   Object  headers  Response headers
       * @return  Void
       */
      function Headers(headers) {
        var self = this;
        this._headers = {};

        // Headers
        if (headers instanceof Headers) {
          headers = headers.raw();
        }

        // plain object
        for (var prop in headers) {
          if (!headers.hasOwnProperty(prop)) {
            continue;
          }

          if (typeof headers[prop] === "string") {
            this.set(prop, headers[prop]);
          } else if (
            typeof headers[prop] === "number" &&
            !isNaN(headers[prop])
          ) {
            this.set(prop, headers[prop].toString());
          } else if (Array.isArray(headers[prop])) {
            headers[prop].forEach(function (item) {
              self.append(prop, item.toString());
            });
          }
        }
      }

      /**
       * Return first header value given name
       *
       * @param   String  name  Header name
       * @return  Mixed
       */
      Headers.prototype.get = function (name) {
        var list = this._headers[name.toLowerCase()];
        return list ? list[0] : null;
      };

      /**
       * Return all header values given name
       *
       * @param   String  name  Header name
       * @return  Array
       */
      Headers.prototype.getAll = function (name) {
        if (!this.has(name)) {
          return [];
        }

        return this._headers[name.toLowerCase()];
      };

      /**
       * Iterate over all headers
       *
       * @param   Function  callback  Executed for each item with parameters (value, name, thisArg)
       * @param   Boolean   thisArg   `this` context for callback function
       * @return  Void
       */
      Headers.prototype.forEach = function (callback, thisArg) {
        Object.getOwnPropertyNames(this._headers).forEach(function (name) {
          this._headers[name].forEach(function (value) {
            callback.call(thisArg, value, name, this);
          }, this);
        }, this);
      };

      /**
       * Overwrite header values given name
       *
       * @param   String  name   Header name
       * @param   String  value  Header value
       * @return  Void
       */
      Headers.prototype.set = function (name, value) {
        this._headers[name.toLowerCase()] = [value];
      };

      /**
       * Append a value onto existing header
       *
       * @param   String  name   Header name
       * @param   String  value  Header value
       * @return  Void
       */
      Headers.prototype.append = function (name, value) {
        if (!this.has(name)) {
          this.set(name, value);
          return;
        }

        this._headers[name.toLowerCase()].push(value);
      };

      /**
       * Check for header name existence
       *
       * @param   String   name  Header name
       * @return  Boolean
       */
      Headers.prototype.has = function (name) {
        return this._headers.hasOwnProperty(name.toLowerCase());
      };

      /**
       * Delete all header values given name
       *
       * @param   String  name  Header name
       * @return  Void
       */
      Headers.prototype["delete"] = function (name) {
        delete this._headers[name.toLowerCase()];
      };

      /**
       * Return raw headers (non-spec api)
       *
       * @return  Object
       */
      Headers.prototype.raw = function () {
        return this._headers;
      };

      /***/
    },
    /******/
  ]
);
