/* eslint-disable */
export const EVENTNATIVE_HOST = 't.jitsu.com';

function formatCode(code: string) {
  let lines: string[] = code.split('\n');
  while (lines.length > 0 && lines[0].trim() === '') {
    lines = lines.slice(1);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines = lines.slice(0, lines.length - 1);
  }
  if (lines.length > 0) {
    let indent = findIndent(lines[0]);
    if (indent.length > 0) {
      lines = lines.map((line) => (line.startsWith(indent) ? line.substr(indent.length) : line));
    }
  }
  return lines.join('\n');
}

function findIndent(str: string) {
  function isWhitespace(char: string) {
    return char === ' ' || char === '\t';
  }
  let ident = [];

  for (let i = 0; i < str.length; i++) {
    let char = str[i];
    if (isWhitespace(char)) {
      ident.push(char);
    } else {
      break;
    }
  }
  return ident.join('');
}

export function getEmpeddedJS(segment: boolean, ga: boolean, key: string, host: string) {
  return formatCode(`
    !function(t){try{var e,n=t.tracking_host,r=(t.script_path||"/")+"s/track.js",i=window.eventN||(window.eventN={});i.eventsQ=e=i.eventsQ||(i.eventsQ=[]);var a=function(t){i[t]=function(){for(var n=arguments.length,r=new Array(n),i=0;i<n;i++)r[i]=arguments[i];return e.push([t].concat(r))}};a("track"),a("id"),a("init"),i.init(t);var c=document.createElement("script");c.type="text/javascript",c.async=!0,c.src=(n.startsWith("https://")||n.startsWith("http://")?n:location.protocol+"//"+n)+r;var s=document.getElementsByTagName("script")[0];s.parentNode.insertBefore(c,s)}catch(t){console.log("EventNative init failed",t)}}({
        "key": "${key}",
        "tracking_host": "https://${host}",
        "ga_hook": ${ga},
        "segment_hook": ${segment}
    });
    eventN.track('pageview');
`);
}

export function getNPMDocumentation(key: string, host: string) {
  return formatCode(`
    const { eventN } = require('@ksense/eventnative');
    //init
    eventN.init({
        key: "${key}",
        tracking_host: "https://${host}"
    });
    //identify user
    eventN.id({
        "email": getEmail(),
        "internal_id": getId()
    });
    //track page views
    eventN.track('app_page');
    `);
}

export function getCurlDocumentation(key: string, host: string) {
  return formatCode(`
    curl -i -X POST -H "Content-Type: application/json" -H 'X-Auth-Token: ${key}' \\
     --data-binary '{"test_str_field": "str", "test_int_field": 42}' 'https://${host}/api/v1/s2s/event'
    `);
}
