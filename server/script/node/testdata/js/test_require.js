/**
 * This test verifies that require works and core modules are available
 */

const stream = require("stream");
const http = require("http");
const url = require("url");
const punycode = require("punycode");
const https = require("https");
const zlib = require("zlib");
const events = require("events");
const net = require("net");
const tls = require("tls");
const buffer = require("buffer");
const string_decoder = require("string_decoder");
const asset = require("assert");
const util = require("util");
const crypto = require("crypto");

function test() {
  return [
    typeof stream,
    typeof http,
    typeof url,
    typeof punycode,
    typeof https,
    typeof zlib,
    typeof events,
    typeof net,
    typeof tls,
    typeof buffer,
    typeof string_decoder,
    typeof asset,
    typeof util,
    typeof url,
    typeof crypto,
  ];
}

module.exports = { test };

