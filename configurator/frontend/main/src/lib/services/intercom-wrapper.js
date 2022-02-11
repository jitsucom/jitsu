export function initIntercom(key, data) {
  if (window && window.Intercom) {
    return
  }
  window.intercomSettings = {
    app_id: key,
    ...(data || {}),
  }
  ;(function () {
    var w = window
    var ic = w.Intercom
    if (typeof ic === "function") {
      ic("reattach_activator")
      ic("update", w.intercomSettings)
    } else {
      var d = document
      var i = function () {
        i.c(arguments)
      }
      i.q = []
      i.c = function (args) {
        i.q.push(args)
      }
      w.Intercom = i
      var l = function () {
        var s = d.createElement("script")
        s.type = "text/javascript"
        s.async = true
        s.src = "https://widget.intercom.io/widget/" + key
        var x = d.getElementsByTagName("script")[0]
        x.parentNode.insertBefore(s, x)
      }
      if (document.readyState === "complete") {
        l()
      } else if (w.attachEvent) {
        w.attachEvent("onload", l)
      } else {
        w.addEventListener("load", l, false)
      }
    }
  })()
}

export function getIntercom() {
  return window.Intercom
}
