(function(cfg) {
  try {
    let host = cfg['tracking_host'];
    let path = (cfg['script_path'] || '/') + 's/track.js'
    let k = window.eventN || (window.eventN = {});
    k.eventsQ = k.eventsQ || (k.eventsQ = []);
    let methods = ['track', 'id', 'init'];
    for (let i = 0; i < methods.length; i++) {
      k[methods[i]] = (...args) => {
        let copy = args.slice();
        copy.unshift(methods[i]);
        k.eventsQ.push(copy);
      }
    }
    k.init(cfg);
    let script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = ((host.startsWith("https://") || host.startsWith("http://") ) ? host : (location.protocol + "//" + host)) + path;
    let orig = document.getElementsByTagName("script")[0];
    orig.parentNode.insertBefore(script, orig);
  } catch (e) {
    console.log("EventNative init failed", e)
  }
})(eventnConfig || {});
