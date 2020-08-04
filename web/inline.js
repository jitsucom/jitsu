(function(...args) {
    try {
        let host = args[1]['tracking_host'];
        let path = (args[1]['script_path'] || '/') + 's/track.js'
        let k = window.eventN || (window.eventN = {});
        k.eventsQ = k.eventsQ || (k.eventsQ = []);
        k.track = (...args) => {k.eventsQ.push(args)}
        k.track(...args);
        let script = document.createElement("script");
        script.type = "text/javascript";
        script.async = true;
        script.src = ((host.startsWith("https://") || host.startsWith("http://") ) ? host : (location.protocol + "//" + host)) + path;
        let orig = document.getElementsByTagName("script")[0];
        orig.parentNode.insertBefore(script, orig);
    } catch (e) {
        console.log("EventNative init failed", e)
    }
})('init', eventnConfig || {});

