---
sort: '0004'
title: 'React'
---

import {CodeInTabs, CodeTab} from "../../../../components/Code";
import {Hint} from '../../../../components/documentationComponents'

# Jitsu React Hooks


Both in [npm based](/docs/sending-data/js-sdk/package) and [snippet](/docs/sending-data/js-sdk/snippet) version Jitsu
accepts the same set of paratemers. The only difference is naming: `param_name` in npm package should be referenced
as `data-param-name` in HTML snippet
EventNative accepts the following parameters.

<table>
    <thead>
    <tr>
        <th>Parameter<br />
            (data- parameter)
        </th>
        <th>Value</th>
    </tr>
    </thead>
    <tbody>
    <tr>
        <td>key *<br />(data-key)</td>
        <td><b>Required.</b> API key <a href="/docs/configuration/authorization">How to get API key</a></td>
    </tr>
    <tr>
        <td>tracking_host<br />(<span style={{whiteSpace: 'nowrap'}}>data-tracking-host</span>)</td>
        <td>If not set, Jitsu will do the best attempt to detect it automatically. For HTML snippet - script location host will be used. For
            npm package, t.jitsu.com is a default host
        </td>
    </tr>
    <tr>
        <td>cookie_name<br />(<span style={{whiteSpace: 'nowrap'}}>data-cookie-name</span>)</td>
        <td>Name of tracking cookie (`__eventn_id` by default)</td>
    </tr>
    <tr>
        <td>segment-hook<br />(<span style={{whiteSpace: 'nowrap'}}>data-tracking-host</span>)</td>
        <td>If set to true, Jitsu will automatically listen to Segment's analytics.js events and collect them.</td>
    </tr>
    <tr>
        <td>randomize_url<br />(<span style={{whiteSpace: 'nowrap'}}>data-randomize-url</span>)</td>
        <td>If set to true, Jitsu will send events on a dynamic endpoint. It allows avoiding ad blockers.</td>
    </tr>
    </tbody>
</table>
