require('console-stamp')(console, 'HH:MM:ss.l');

const fs = require('fs');
const {spawn} = require('child_process');
const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");

const openBrowser = require('react-dev-utils/openBrowser');
const {choosePort} = require('react-dev-utils/WebpackDevServerUtils');

const rollup = require('rollup')
const loadConfigFile = require('rollup/dist/loadConfigFile')


const DEFAULT_PORT = 4000;
const PORT = process.env.TRACK_DEMO_PORT || DEFAULT_PORT;
const HOST = 'localhost';
const DEFAULT_USE_PROD_FILES = true;
const WATCH_AND_BUILD_TRACKER = process.env.WATCH_AND_BUILD_TRACKER || true;


let globalPort = PORT;


const useProdFiles = process.env.USE_PROD_FILE === undefined ? DEFAULT_USE_PROD_FILES : process.env.USE_PROD_FILE;
const testHtmlPath = path.resolve("./test.html");

async function buildTracker() {
    if (WATCH_AND_BUILD_TRACKER) {
        console.log("Building JS SDK with Rollup...")
        const {options, warnings} = await loadConfigFile(path.resolve(__dirname, 'rollup.config.js'), {format: 'es'});
        console.log(`Rollup build currently have ${warnings.count} warnings`);
        warnings.flush();
        options.map(async option => {
            const bundle = await rollup.rollup(option)
            await Promise.all(option.output.map(bundle.write))
            rollup.watch(option).on('event', event => {
                if (event.code === 'BUNDLE_START') {
                    console.log(`Building ${event.input}`);
                } else if (event.code === 'BUNDLE_END') {
                    console.log(`${event.input} has been built successfully!`)
                } else if (event.code === 'ERROR') {
                    console.error("Error", event.error)
                }
            })
        })
        console.log("Rollup build completed!")
    }
}

function prepareJsFile(file) {
    let fullFilePath = path.join(__dirname, useProdFiles ? "./dist/web" : "./src", file);
    return () => {
        let content = fs.readFileSync(fullFilePath, 'utf8');
        return content.replace('"use strict";', '')
    };
}

function getTrackingHost(req) {
    let protocol = req.headers['x-forwarded-proto'] || req.protocol;
    let hostname = req.headers['host'] || req.hostname;
    let port = req.headers['x-forwarded-port'] || (globalPort + "");
    let host = protocol + "://" + hostname;
    if (port !== "80" && protocol === "http") {
        host += ":" + port
    }
    if (port !== "443" && protocol === "https") {
        host += ":" + port
    }
    return host;
}

function addJsHeaders(res) {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Access-Control-Allow-Origin', '*');
}

const trackJs = prepareJsFile('track.js')
const inlineJs = prepareJsFile('inline.js')
const eventNConfigPlaceholder = 'eventnConfig'

const devserver = express();
devserver.use(bodyParser.text())
devserver.use(bodyParser.json())

devserver.get('/', (req, res) => {
    res.sendFile(testHtmlPath);
});

devserver.use(express.static('demo'))
//devserver.use(express.json());


devserver.use(function (req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST');
    res.header('Access-Control-Expose-Headers', 'Content-Length');
    res.header('Access-Control-Allow-Headers', 'Accept, Authorization, Content-Type, X-Requested-With, Range');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    } else {
        return next();
    }
});

let apiHandler = (req, res) => {
    let bodyJson = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
    console.log('Event' + req.method + ' ' + JSON.stringify(bodyJson, null, 2) + "\n\nHeaders: " + JSON.stringify(req.headers, null, 2));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send({status: 'ok'});
};
devserver.post('/api/v1/event', apiHandler)
devserver.post('/api.*', apiHandler)

devserver.get("/s/track.js", (req, res) => {
    addJsHeaders(res);
    res.send(trackJs());
});

devserver.get('/t/inline.js', (req, res) => {
    const toBool = str => str === "true";
    const asIs = str => str;
    const accepted_params = {'key': asIs, 'segment_hook': toBool, 'tracking_host': asIs, 'cookie_domain': asIs, 'ga_hook': toBool, 'debug': toBool()};
    if (!req.query['key']) {
        throw new Error("Mandatory key parameter is missing");
    }
    let config = {}
    for (const [property, transform] of Object.entries(accepted_params)) {
        if (req.query[property] !== undefined) {
            config[property] = transform(req.query[property]);
        }
    }
    let trackingHost = config['tracking_host'] || getTrackingHost(req);
    config['tracking_host'] = trackingHost

    src = trackingHost;
    if (!trackingHost.startsWith("http://") && !trackingHost.startsWith("https://") && !trackingHost.startsWith("//")) {
        src = "//" + src
    }
    src += "/s/track"
    src += ".js"
    config['script_src'] = src
    addJsHeaders(res);
    let js = inlineJs().replace(eventNConfigPlaceholder, JSON.stringify(config, null, 2));
    if (req.query.event) {
        js += `\neventN.track('${req.query.event}');\n`
    }
    res.send(js);
});

choosePort(HOST, PORT).then(async selectedPort => {
    if (selectedPort == null) {
        // We have not found a selectedPort.
        return;
    }

    globalPort = selectedPort;

    devserver.listen(globalPort, async () => {
        await buildTracker();
        console.log(`Started at ${globalPort}!`);

        // console.log('Opening browser...');
        // openBrowser('http://' + HOST + ':' + globalPort + '/');

        if (process.argv.indexOf('--watch') > -1) {
            console.log('Watching changes...');
            spawn('npm', ['run', 'watch'], {stdio: 'inherit'});
        }
    });
});