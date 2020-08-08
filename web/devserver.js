require('console-stamp')(console, 'HH:MM:ss.l');

const fs = require('fs');
const express = require('express');
var cors = require('cors')
const path = require('path');
const devserver = express();
const port = process.env.TRACK_DEMO_PORT ? process.env.TRACK_DEMO_PORT : 80;
const useProdFiles = process.env.USE_PROD_FILES ? true : false;

function prepareJsFile(file) {
    let fullFilePath = useProdFiles ? path.join(__dirname, "/build", file) : path.join(__dirname, file);
    return () => {
        let content = fs.readFileSync(fullFilePath, 'utf8');
        return content.replace('"use strict";', '')
    };
}

function getTrackingHost(req) {
    let host = req.protocol + "://" + req.hostname;
    if (port !== 80 && req.protocol === "http") {
        host += ":" + port
    }
    if (port !== 443 && req.protocol === "https") {
        host += ":" + port
    }
    return host;
}

const trackJs = prepareJsFile('build/track.js')
const inlineJs = prepareJsFile('build/inline.js')

devserver.use(express.static('demo'))
devserver.use(express.json());
devserver.use(function(req, res, next) {
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
function addJsHeaders(res) {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Access-Control-Allow-Origin', '*');
}


devserver.post('/api/v1/event', (req, res) => {
    console.log('Event', JSON.stringify(req.body, null, 2));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send({status: 'ok'});
})

devserver.get("/s/track.js", (req, res) => {
    addJsHeaders(res);
    res.send(trackJs());
});


devserver.get('/t/inline.js', (req, res) => {
    const toBool = str => str === "true";
    const asIs = str => str;
    const accepted_params = {'key': asIs, 'segment_hook': toBool, 'tracking_host': asIs , 'cookie_domain': asIs, 'ga_hook': toBool};
    if (!req.query['key']) {
        throw new Error("Mandatory key paramter is missing");
    }
    let config = {}
    for (const [property, transform] of Object.entries(accepted_params)) {
        if (req.query[property] !== undefined) {
            config[property] = transform(req.query[property]);
        }
    }
    config['tracking_host'] = config['tracking_host'] || getTrackingHost(req);
    addJsHeaders(res);
    res.send(`var eventnConfig = ${JSON.stringify(config, null, 2)};\n${inlineJs()}`);
});

devserver.listen(port, () => console.log(`Started at ${port}!`));
