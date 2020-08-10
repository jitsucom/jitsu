(function(o, p, d) {
  try {
    var q = [],
        push = function() { q.push(arguments) },
        s = document.createElement("script"),
        src = o.tracking_host.replace(
          /^https?:\/\//, location.protocol + '//'
        ) + (o.script_path || '/') + 's/track.' + (p.sort().join('.')) + (d ? '.debug' : ''),
        orig = document.getElementsByTagName("script")[0];
    window.eventN = {
      q: q,
      o: o,
      id: function () { q.push(['id', arguments]) },
      track: function () { q.push(['track', arguments]) },
    };
    s.type = "text/javascript";
    s.async = true;
    s.src = src;
    orig.parentNode.insertBefore(s, orig);
  } catch (e) {
    console.log("EventNative init failed", e)
  }
})({}, [], true);
