(function(cfg) {
  try {
    let k = window.eventN || (window.eventN = {}), q;
    k.eventsQ = q = k.eventsQ || (k.eventsQ = []);
    const addMethod = m => {
      k[m] = (...args) => q.push([m, ...args]);
    }
    addMethod('track')
    addMethod('id')
    addMethod('init')

    k.init(cfg);
    let script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = cfg.script_src;
    let orig = document.getElementsByTagName("script")[0];
    orig.parentNode.insertBefore(script, orig);
  } catch (e) {
    console.log("EventNative init failed", e)
  }
})(eventnConfig);
