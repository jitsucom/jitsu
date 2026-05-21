package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	kafka2 "github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/jitsubase/uuid"
)

const (
	TokenName       = "token"
	APIKeyName      = "api_key"
	TokenHeaderName = "x-auth-token"

	JitsuAnonymIDCookie   = "__eventn_id"
	CookiePolicyParameter = "cookie_policy"
	IPPolicyParameter     = "ip_policy"

	KeepValue   = "keep"
	StrictValue = "strict"
	ComplyValue = "comply"

	sLibJsEtag = "\"11a64df551425fcc55e4d42a148795d9f25f89d4\""
)

var ids = sync.Map{}

func init() {
	ticker := time.NewTicker(60 * time.Minute)
	go func() {
		for range ticker.C {
			arr := make([]string, 0)
			ids.Range(func(key, value interface{}) bool {
				arr = append(arr, fmt.Sprintf("%v(%v)", key, value))
				return true
			})
			logging.Infof("[Classic] %s", strings.Join(arr, ","))
		}
	}()
}

var sLibJs = []byte(`!function(){var e=function(){return e=Object.assign||function(e){for(var t,n=1,i=arguments.length;n<i;n++)for(var o in t=arguments[n])Object.prototype.hasOwnProperty.call(t,o)&&(e[o]=t[o]);return e},e.apply(this,arguments)};function t(e,t,n,i){return new(n||(n=Promise))((function(o,r){function s(e){try{c(i.next(e))}catch(e){r(e)}}function a(e){try{c(i.throw(e))}catch(e){r(e)}}function c(e){var t;e.done?o(e.value):(t=e.value,t instanceof n?t:new n((function(e){e(t)}))).then(s,a)}c((i=i.apply(e,t||[])).next())}))}function n(e,t){var n,i,o,r,s={label:0,sent:function(){if(1&o[0])throw o[1];return o[1]},trys:[],ops:[]};return r={next:a(0),throw:a(1),return:a(2)},"function"==typeof Symbol&&(r[Symbol.iterator]=function(){return this}),r;function a(r){return function(a){return function(r){if(n)throw new TypeError("Generator is already executing.");for(;s;)try{if(n=1,i&&(o=2&r[0]?i.return:r[0]?i.throw||((o=i.return)&&o.call(i),0):i.next)&&!(o=o.call(i,r[1])).done)return o;switch(i=0,o&&(r=[2&r[0],o.value]),r[0]){case 0:case 1:o=r;break;case 4:return s.label++,{value:r[1],done:!1};case 5:s.label++,i=r[1],r=[0];continue;case 7:r=s.ops.pop(),s.trys.pop();continue;default:if(!(o=s.trys,(o=o.length>0&&o[o.length-1])||6!==r[0]&&2!==r[0])){s=0;continue}if(3===r[0]&&(!o||r[1]>o[0]&&r[1]<o[3])){s.label=r[1];break}if(6===r[0]&&s.label<o[1]){s.label=o[1],o=r;break}if(o&&s.label<o[2]){s.label=o[2],s.ops.push(r);break}o[2]&&s.ops.pop(),s.trys.pop();continue}r=t.call(e,s)}catch(e){r=[6,e],i=0}finally{n=o=0}if(5&r[0])throw r[1];return{value:r[0]?r[1]:void 0,done:!0}}([r,a])}}}function i(e,t,n){if(n||2===arguments.length)for(var i,o=0,r=t.length;o<r;o++)!i&&o in t||(i||(i=Array.prototype.slice.call(t,0,o)),i[o]=t[o]);return e.concat(i||Array.prototype.slice.call(t))}function o(e){let t=!!globalThis.window;return!t&&e&&c().warn(e),t}function r(e){if(!o())throw new Error(e||"window' is not available. Seems like this code runs outside browser environment. It shouldn't happen");return window}var s={DEBUG:{name:"DEBUG",severity:10},INFO:{name:"INFO",severity:100},WARN:{name:"WARN",severity:1e3},ERROR:{name:"ERROR",severity:1e4},NONE:{name:"NONE",severity:1e4}},a=null;function c(){return a||(a=u())}function u(e){var t=o()&&window.__eventNLogLevel,n=s.WARN;if(t){var r=s[t.toUpperCase()];r&&r>0&&(n=r)}else e&&(n=e);var a={minLogLevel:n};return Object.values(s).forEach((function(e){var t=e.name,o=e.severity;a[t.toLowerCase()]=function(){for(var e=[],r=0;r<arguments.length;r++)e[r]=arguments[r];if(o>=n.severity&&e.length>0){var s=e[0],a=e.splice(1),c="[J-".concat(t,"] ").concat(s);"DEBUG"===t||"INFO"===t?console.log.apply(console,i([c],a,!1)):"WARN"===t?console.warn.apply(console,i([c],a,!1)):console.error.apply(console,i([c],a,!1))}}})),function(e,t){if(o()){var n=window;n.__jitsuDebug||(n.__jitsuDebug={}),n.__jitsuDebug[e]=t}}("logger",a),a}function l(e,t,n){var i;void 0===n&&(n={});var o=e+"="+encodeURIComponent(t);if(o+="; Path="+(null!==(i=n.path)&&void 0!==i?i:"/"),n.maxAge&&(o+="; Max-Age="+Math.floor(n.maxAge)),n.domain&&(o+="; Domain="+n.domain),n.expires&&(o+="; Expires="+n.expires.toUTCString()),n.httpOnly&&(o+="; HttpOnly"),n.secure&&(o+="; Secure"),n.sameSite)switch("string"==typeof n.sameSite?n.sameSite.toLowerCase():n.sameSite){case!0:o+="; SameSite=Strict";break;case"lax":o+="; SameSite=Lax";break;case"strict":o+="; SameSite=Strict";break;case"none":o+="; SameSite=None";break;default:throw new TypeError("option sameSite is invalid")}return o}var p;function d(e){if(!e)return{};for(var t={},n=e.split(";"),i=0;i<n.length;i++){var o=n[i],r=o.indexOf("=");r>0&&(t[o.substr(i>0?1:0,i>0?r-1:r)]=o.substr(r+1))}return t}function h(e,t){return Array.from(e.attributes).forEach((function(e){t.setAttribute(e.nodeName,e.nodeValue)}))}function f(e,t){e.innerHTML=t;var n,i=e.getElementsByTagName("script");for(n=i.length-1;n>=0;n--){var o=i[n],r=document.createElement("script");h(o,r),o.innerHTML&&(r.innerHTML=o.innerHTML),r.setAttribute("data-jitsu-tag-id",e.id),document.getElementsByTagName("head")[0].appendChild(r),i[n].parentNode.removeChild(i[n])}}var m=function(e){return e&&decodeURIComponent(r().document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*"+encodeURIComponent(e).replace(/[\-\.\+\*]/g,"\\$&")+"\\s*\\=\\s*([^;]*).*$)|^.*$"),"$1"))||null},v=function(e,t,n){void 0===n&&(n={}),r().document.cookie=l(e,t,n)},g=function(e,t){void 0===t&&(t="/"),document.cookie=e+"= ; expires = Thu, 01 Jan 1970 00:00:00 GMT"+(t?"; path = "+t:"")},y=function(){return Math.random().toString(36).substring(2,12)},_=function(){return Math.random().toString(36).substring(2,7)},b={utm_source:"source",utm_medium:"medium",utm_campaign:"campaign",utm_term:"term",utm_content:"content"},w={gclid:!0,fbclid:!0,dclid:!0};var k="__buildEnv__",P="__buildDate__",S="".concat("__buildVersion__","/").concat(k,"@").concat(P),j=316224e3,O=function(e,t){c().debug("Sending beacon",t);var n=new Blob([t],{type:"text/plain"});return navigator.sendBeacon(e,n),Promise.resolve()};var N=function(e,t){return console.log("Jitsu client tried to send payload to ".concat(e),function(e){if("string"==typeof e)try{return JSON.stringify(JSON.parse(e),null,2)}catch(t){return e}}(t)),Promise.resolve()};function E(e,t){void 0===t&&(t=void 0),""!=(t=null!=t?t:window.location.pathname)&&"/"!=t&&(g(e,t),E(e,t.slice(0,t.lastIndexOf("/"))))}var A=function(){function e(e,t){this.cookieDomain=e,this.cookieName=t}return e.prototype.save=function(e){v(this.cookieName,JSON.stringify(e),{domain:this.cookieDomain,secure:"http:"!==document.location.protocol,maxAge:j})},e.prototype.restore=function(){E(this.cookieName);var e=m(this.cookieName);if(e)try{var t=JSON.parse(decodeURIComponent(e));return"object"!=typeof t?void c().warn("Can't restore value of ".concat(this.cookieName,"@").concat(this.cookieDomain,", expected to be object, but found ").concat("object"!=typeof t,": ").concat(t,". Ignoring")):t}catch(t){return void c().error("Failed to decode JSON from "+e,t)}},e.prototype.delete=function(){g(this.cookieName)},e}(),I=function(){function e(){}return e.prototype.save=function(e){},e.prototype.restore=function(){},e.prototype.delete=function(){},e}();var C={getSourceIp:function(){},describeClient:function(){return{referer:document.referrer,url:window.location.href,page_title:document.title,doc_path:document.location.pathname,doc_host:document.location.hostname,doc_search:window.location.search,screen_resolution:screen.width+"x"+screen.height,vp_size:Math.max(document.documentElement.clientWidth||0,window.innerWidth||0)+"x"+Math.max(document.documentElement.clientHeight||0,window.innerHeight||0),user_agent:navigator.userAgent,user_language:navigator.language,doc_encoding:document.characterSet}},getAnonymousId:function(e){var t=e.name,n=e.domain;E(t);var i=m(t);if(i)return c().debug("Existing user id",i),i;var o=y();return c().debug("New user id",o),v(t,o,{domain:n,secure:"http:"!==document.location.protocol,maxAge:j}),o}};var x={getSourceIp:function(){},describeClient:function(){return{}},getAnonymousId:function(){return""}},J=function(){return C},T=function(){return x},H=function(e,t,n,i){void 0===i&&(i=function(e,t){});var o=new window.XMLHttpRequest;return new Promise((function(r,s){o.onerror=function(e){c().error("Failed to send",t,e),i(-1,{}),s(new Error("Failed to send JSON. See console logs"))},o.onload=function(){200!==o.status?(i(o.status,{}),c().warn("Failed to send data to ".concat(e," (#").concat(o.status," - ").concat(o.statusText,")"),t),s(new Error("Failed to send JSON. Error code: ".concat(o.status,". See logs for details")))):i(o.status,o.responseText),r()},o.open("POST",e),o.setRequestHeader("Content-Type","application/json"),Object.entries(n||{}).forEach((function(e){var t=e[0],n=e[1];return o.setRequestHeader(t,n)})),o.send(t),c().debug("sending json",t)}))},R=function(){function i(){this.userProperties={},this.permanentProperties={globalProps:{},propsPerEvent:{}},this.cookieDomain="",this.trackingHost="",this.idCookieName="",this.randomizeUrl=!1,this.apiKey="",this.initialized=!1,this._3pCookies={},this.cookiePolicy="keep",this.ipPolicy="keep",this.beaconApi=!1,this.transport=H,this.customHeaders=function(){return{}}}return i.prototype.id=function(t,n){return this.userProperties=e(e({},this.userProperties),t),c().debug("Jitsu user identified",t),this.userIdPersistence?this.userIdPersistence.save(t):c().warn("Id() is called before initialization"),n?Promise.resolve():this.track("user_identify",{})},i.prototype.rawTrack=function(e){return this.sendJson(e)},i.prototype.makeEvent=function(t,n,i){var r,s=i.env,a=function(e,t){var n={};for(var i in e)Object.prototype.hasOwnProperty.call(e,i)&&t.indexOf(i)<0&&(n[i]=e[i]);if(null!=e&&"function"==typeof Object.getOwnPropertySymbols){var o=0;for(i=Object.getOwnPropertySymbols(e);o<i.length;o++)t.indexOf(i[o])<0&&Object.prototype.propertyIsEnumerable.call(e,i[o])&&(n[i[o]]=e[i[o]])}return n}(i,["env"]);s||(s=o()?J():T()),this.restoreId();var c=this.getCtx(s),u=e(e({},this.permanentProperties.globalProps),null!==(r=this.permanentProperties.propsPerEvent[t])&&void 0!==r?r:{}),l=e({api_key:this.apiKey,src:n,event_type:t},a),p=s.getSourceIp();return p&&(l.source_ip=p),this.compatMode?e(e(e({},u),{eventn_ctx:c}),l):e(e(e({},u),c),l)},i.prototype._send3p=function(e,t,n){var i="3rdparty";n&&""!==n&&(i=n);var o=this.makeEvent(i,e,{src_payload:t});return this.sendJson(o)},i.prototype.sendJson=function(e){var t=this,n="keep"!==this.cookiePolicy?"&cookie_policy=".concat(this.cookiePolicy):"",i="keep"!==this.ipPolicy?"&ip_policy=".concat(this.ipPolicy):"",r=o()?"/api/v1/event":"/api/v1/s2s/event",s="".concat(this.trackingHost).concat(r,"?token=").concat(this.apiKey).concat(n).concat(i);this.randomizeUrl&&(s="".concat(this.trackingHost,"/api.").concat(_(),"?p_").concat(_(),"=").concat(this.apiKey).concat(n).concat(i));var a=JSON.stringify(e);return c().debug("Sending payload to ".concat(s),a),this.transport(s,a,this.customHeaders(),(function(e,n){return t.postHandle(e,n)}))},i.prototype.postHandle=function(e,t){if("strict"===this.cookiePolicy||"comply"===this.cookiePolicy){if(200===e){var n=t;if("string"==typeof t&&(n=JSON.parse(t)),!n.delete_cookie)return}this.userIdPersistence.delete(),this.propsPersistance.delete(),g(this.idCookieName)}if(200===e){n=t;if("string"==typeof t&&t.length>0){var i=(n=JSON.parse(t)).jitsu_sdk_extras;if(i&&i.length>0)if(o())for(var r=0,s=i;r<s.length;r++){var a=s[r],u=a.type,l=a.id,p=a.value;if("tag"===u){var d=document.createElement("div");d.id=l,f(d,p),d.childElementCount>0&&document.body.appendChild(d)}}else c().error("Tags destination supported only in browser environment")}}},i.prototype.getCtx=function(t){var n,i,o=new Date,r=t.describeClient()||{};return e(e({event_id:"",user:e({anonymous_id:"strict"!==this.cookiePolicy?t.getAnonymousId({name:this.idCookieName,domain:this.cookieDomain}):""},this.userProperties),ids:this._getIds(),utc_time:(n=o.toISOString(),i=n.split(".")[1],i?i.length>=7?n:n.slice(0,-1)+"0".repeat(7-i.length)+"Z":n),local_tz_offset:o.getTimezoneOffset()},r),function(e){var t={utm:{},click_id:{}};for(var n in e)if(e.hasOwnProperty(n)){var i=e[n],o=b[n];o?t.utm[o]=i:w[n]&&(t.click_id[n]=i)}return t}(function(e){if(!e)return{};for(var t=e.length>0&&"?"===e.charAt(0)?e.substring(1):e,n={},i=("?"===t[0]?t.substr(1):t).split("&"),o=0;o<i.length;o++){var r=i[o].split("=");n[decodeURIComponent(r[0])]=decodeURIComponent(r[1]||"")}return n}(r.doc_search)))},i.prototype._getIds=function(){if(!o())return{};for(var e=function(e){if(void 0===e&&(e=!1),e&&p)return p;var t=d(document.cookie);return p=t,t}(!1),t={},n=0,i=Object.entries(e);n<i.length;n++){var r=i[n],s=r[0],a=r[1];this._3pCookies[s]&&(t["_"==s.charAt(0)?s.substr(1):s]=a)}return t},i.prototype.track=function(e,t){var n=t||{};c().debug("track event of type",e,n);var i=this.makeEvent(e,this.compatMode?"eventn":"jitsu",t||{});return this.sendJson(i)},i.prototype.init=function(i){var r,l,p,d,h,f=this;if(o()&&!i.force_use_fetch)i.fetch&&c().warn("Custom fetch implementation is provided to Jitsu. However, it will be ignored since Jitsu runs in browser"),this.transport=this.beaconApi?O:H;else{if(!i.fetch&&!globalThis.fetch)throw new Error("Jitsu runs in Node environment. However, neither JitsuOptions.fetch is provided, nor global fetch function is defined. \nPlease, provide custom fetch implementation. You can get it via node-fetch package");this.transport=(p=i.fetch||globalThis.fetch,function(i,o,r,s){return void 0===s&&(s=function(e,t){}),t(void 0,void 0,void 0,(function(){var t,a,u;return n(this,(function(n){switch(n.label){case 0:return n.trys.push([0,2,,3]),[4,p(i,{method:"POST",headers:e({Accept:"application/json","Content-Type":"application/json"},r||{}),body:o})];case 1:return t=n.sent(),[3,3];case 2:throw a=n.sent(),c().error("Failed to send",o,a),s(-1,{}),new Error("Failed to send JSON. See console logs");case 3:if(200!==t.status)throw c().warn("Failed to send data to ".concat(i," (#").concat(t.status," - ").concat(t.statusText,")"),o),new Error("Failed to send JSON. Error code: ".concat(t.status,". See logs for details"));return[4,t.json()];case 4:return u=n.sent(),s(t.status,u),[2]}}))}))})}if(i.custom_headers&&"function"==typeof i.custom_headers?this.customHeaders=i.custom_headers:i.custom_headers&&(this.customHeaders=function(){return i.custom_headers}),"echo"===i.tracking_host&&(c().warn('jitsuClient is configured with "echo" transport. Outgoing requests will be written to console'),this.transport=N),i.ip_policy&&(this.ipPolicy=i.ip_policy),i.cookie_policy&&(this.cookiePolicy=i.cookie_policy),"strict"===i.privacy_policy&&(this.ipPolicy="strict",this.cookiePolicy="strict"),i.use_beacon_api&&navigator.sendBeacon&&(this.beaconApi=!0),"comply"===this.cookiePolicy&&this.beaconApi&&(this.cookiePolicy="strict"),i.log_level&&(d=i.log_level,(h=s[d.toLocaleUpperCase()])||(console.warn("Can't find log level with name ".concat(d.toLocaleUpperCase(),", defaulting to INFO")),h=s.INFO),a=u(h)),this.initialOptions=i,c().debug("Initializing Jitsu Tracker tracker",i,S),i.key){if(this.compatMode=void 0!==i.compat_mode&&!!i.compat_mode,this.cookieDomain=i.cookie_domain||function(){if(o())return window.location.hostname.replace("www.","")}(),this.trackingHost=function(e){for(;n="/",-1!==(t=e).indexOf(n,t.length-n.length);)e=e.substr(0,e.length-1);var t,n;return 0===e.indexOf("https://")||0===e.indexOf("http://")?e:"//"+e}(i.tracking_host||"t.jitsu.com"),this.randomizeUrl=i.randomize_url||!1,this.idCookieName=i.cookie_name||"__eventn_id",this.apiKey=i.key,"strict"===this.cookiePolicy?this.propsPersistance=new I:this.propsPersistance=o()?new A(this.cookieDomain,this.idCookieName+"_props"):new I,"strict"===this.cookiePolicy?this.userIdPersistence=new I:this.userIdPersistence=o()?new A(this.cookieDomain,this.idCookieName+"_usr"):new I,this.propsPersistance){var m=this.propsPersistance.restore();m&&(this.permanentProperties=m,this.permanentProperties.globalProps=null!==(r=m.globalProps)&&void 0!==r?r:{},this.permanentProperties.propsPerEvent=null!==(l=m.propsPerEvent)&&void 0!==l?l:{}),c().debug("Restored persistent properties",this.permanentProperties)}!1===i.capture_3rd_party_cookies?this._3pCookies={}:(i.capture_3rd_party_cookies||["_ga","_fbp","_ym_uid","ajs_user_id","ajs_anonymous_id"]).forEach((function(e){return f._3pCookies[e]=!0})),i.ga_hook&&c().warn("GA event interceptor isn't supported anymore"),i.segment_hook&&function(e){var t=window;t.analytics||(t.analytics=[]);e.interceptAnalytics(t.analytics)}(this),this.initialized=!0}else c().error("Can't initialize Jitsu, key property is not set")},i.prototype.interceptAnalytics=function(t){var n=this,i=function(t){var i;try{var o=e({},t.payload);c().debug("Intercepted segment payload",o.obj);var r=t.integrations["Segment.io"];if(r&&r.analytics){var s=r.analytics;"function"==typeof s.user&&s.user()&&"function"==typeof s.user().id&&(o.obj.userId=s.user().id())}(null===(i=null==o?void 0:o.obj)||void 0===i?void 0:i.timestamp)&&(o.obj.sentAt=o.obj.timestamp);var a=t.payload.type();"track"===a&&(a=t.payload.event()),n._send3p("ajs",o,a)}catch(e){c().warn("Failed to send an event",e)}t.next(t.payload)};"function"==typeof t.addSourceMiddleware?(c().debug("Analytics.js is initialized, calling addSourceMiddleware"),t.addSourceMiddleware(i)):(c().debug("Analytics.js is not initialized, pushing addSourceMiddleware to callstack"),t.push(["addSourceMiddleware",i])),t.__en_intercepted=!0},i.prototype.restoreId=function(){if(this.userIdPersistence){var t=this.userIdPersistence.restore();t&&(this.userProperties=e(e({},t),this.userProperties))}},i.prototype.set=function(t,n){var i,o=null==n?void 0:n.eventType,r=void 0===(null==n?void 0:n.persist)||(null==n?void 0:n.persist);if(void 0!==o){var s=null!==(i=this.permanentProperties.propsPerEvent[o])&&void 0!==i?i:{};this.permanentProperties.propsPerEvent[o]=e(e({},s),t)}else this.permanentProperties.globalProps=e(e({},this.permanentProperties.globalProps),t);this.propsPersistance&&r&&this.propsPersistance.save(this.permanentProperties)},i.prototype.unset=function(e,t){r();var n=null==t?void 0:t.eventType,i=void 0===(null==t?void 0:t.persist)||(null==t?void 0:t.persist);n?this.permanentProperties.propsPerEvent[n]&&delete this.permanentProperties.propsPerEvent[n][e]:delete this.permanentProperties.globalProps[e],this.propsPersistance&&i&&this.propsPersistance.save(this.permanentProperties)},i}();var z=["use_beacon_api","cookie_domain","tracking_host","cookie_name","key","ga_hook","segment_hook","randomize_url","capture_3rd_party_cookies","id_method","log_level","compat_mode","privacy_policy","cookie_policy","ip_policy","custom_headers","force_use_fetch"];var M="data-suppress-interception-warning";function D(e){return"\n      ATTENTION! ".concat(e,"-hook set to true along with defer/async attribute! If ").concat(e," code is inserted right after Jitsu tag,\n      first tracking call might not be intercepted! Consider one of the following:\n       - Inject jitsu tracking code without defer/async attribute\n       - If you're sure that events won't be sent to ").concat(e," before Jitsu is fully initialized, set ").concat(M,'="true"\n       script attribute\n    ')}function F(e,t){c().debug("Processing queue",e);for(var n=0;n<e.length;n+=1){var o=i([],e[n],!0)||[],r=o[0],s=o.slice(1),a=t[r];"function"==typeof a&&a.apply(t,s)}e.length=0}if(window){var U=window,L=function(e){var t=document.currentScript||document.querySelector("script[src*=jsFileName][data-jitsu-api-key]");if(t){var n,i={tracking_host:(n=t.getAttribute("src"),n.replace("/s/lib.js","").replace("/lib.js","")),key:null};z.forEach((function(e){var n="data-"+e.replace(new RegExp("_","g"),"-");if(void 0!==t.getAttribute(n)&&null!==t.getAttribute(n)){var o=t.getAttribute(n);"true"===o?o=!0:"false"===o&&(o=!1),i[e]=o}})),e.jitsuClient=function(e){var t=new R;return t.init(e),t}(i),!i.segment_hook||null===t.getAttribute("defer")&&null===t.getAttribute("async")||null!==t.getAttribute(M)||c().warn(D("segment")),!i.ga_hook||null===t.getAttribute("defer")&&null===t.getAttribute("async")||null!==t.getAttribute(M)||c().warn(D("ga"));var o=function(){var t=e.jitsuQ=e.jitsuQ||[];t.push(arguments),F(t,e.jitsuClient)};return e.jitsu=o,"true"!==t.getAttribute("data-init-only")&&"yes"!==t.getAttribute("data-init-only")&&o("track","pageview"),e.jitsuClient}c().warn("Jitsu script is not properly initialized. The definition must contain data-jitsu-api-key as a parameter")}(U);L?(c().debug("Jitsu in-browser tracker has been initialized"),U.jitsu=function(){var e=U.jitsuQ=U.jitsuQ||[];e.push(arguments),F(e,L)},U.jitsuQ&&(c().debug("Initial queue size of ".concat(U.jitsuQ.length," will be processed")),F(U.jitsuQ,L))):c().error("Jitsu tracker has not been initialized (reason unknown)")}else c().warn("Jitsu tracker called outside browser context. It will be ignored")}();`)

func (r *Router) ClassicScriptHandler(c *gin.Context) {
	if c.Request.Method != "GET" && c.Request.Method != "HEAD" {
		c.AbortWithStatus(http.StatusMethodNotAllowed)
		return
	}

	ifNoneMatch := c.GetHeader("If-None-Match")
	c.Header("ETag", sLibJsEtag)
	if ifNoneMatch == sLibJsEtag {
		c.AbortWithStatus(http.StatusNotModified)
		return
	}
	c.Header("Content-Length", fmt.Sprintf("%d", len(sLibJs)))
	if c.Request.Method == "HEAD" {
		c.Header("Content-Type", "application/javascript")
		c.Status(http.StatusOK)
		return
	} else {
		c.Data(http.StatusOK, "application/javascript", sLibJs)
	}
}

func (r *Router) ClassicHandler(c *gin.Context) {
	domain := ""
	metricsId := "UNKNOWN"
	var rError *appbase.RouterError
	ingestType := IngestTypeBrowser
	var s2sEndpoint bool

	defer func() {
		IngestedMessagesReceived(metricsId, "received").Inc()
		if rError != nil {
			IngestHandlerRequests(domain, "error", rError.ErrorType).Inc()
			IngestedMessagesReceived(metricsId, "errors").Inc()
		}
	}()
	defer func() {
		if rerr := recover(); rerr != nil {
			rError = r.ResponseError(c, http.StatusInternalServerError, "panic", true, fmt.Errorf("%v", rerr), true, true, false)
		}
	}()
	c.Set(appbase.ContextLoggerName, "ingest")
	if !strings.HasSuffix(c.ContentType(), "application/json") && !strings.HasSuffix(c.ContentType(), "text/plain") {
		rError = r.ResponseError(c, http.StatusBadRequest, "invalid content type", false, fmt.Errorf("%s. Expected: application/json", c.ContentType()), true, true, false)
		return
	}
	if strings.HasPrefix(c.FullPath(), "/api/v1/s2s/") {
		// may still be overridden by write key type
		s2sEndpoint = true
		ingestType = IngestTypeS2S
	}

	loc, err := r.getDataLocator(c, ingestType, func() (token string) {
		token = utils.NvlString(c.Query(TokenName), c.GetHeader(TokenHeaderName), c.GetHeader(APIKeyName))
		if token != "" {
			return
		}
		for k, v := range c.Request.URL.Query() {
			if strings.HasPrefix(k, "p_") && len(v) > 0 {
				return v[0]
			}
		}
		return
	})
	if err != nil {
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "error processing message", false, err, true, true, false)
		return
	}
	domain = utils.DefaultString(loc.Slug, loc.Domain)
	metricsId = domain
	c.Set(appbase.ContextDomain, domain)
	c.Set("_classic_api_key", loc.WriteKey)

	stream := r.getStream(&loc, true, s2sEndpoint)
	if stream == nil {
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusUnauthorized, http.StatusOK), "stream not found", false, fmt.Errorf("for: %s", loc.String()), true, true, true)
		return
	}
	s2sEndpoint = s2sEndpoint || loc.IngestType == IngestTypeS2S

	metricsId = stream.Stream.Id
	ids.Store(stream.Stream.Id, stream.Stream.WorkspaceId)
	var body []byte
	body, err = io.ReadAll(c.Request.Body)
	if err != nil {
		err = fmt.Errorf("Client Ip: %s: %v", utils.NvlString(c.GetHeader("X-Real-Ip"), c.GetHeader("X-Forwarded-For"), c.ClientIP()), err)
		rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "error reading HTTP body", false, err, true, true, false)
		return
	}

	//if body is array, parse as array of messages
	messages := make([]types.Json, 0)
	if body[0] == '[' {
		err = jsonorder.Unmarshal(body, &messages)
		if err != nil {
			rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "error parsing message", false, fmt.Errorf("%v: %s", err, string(body)), true, true, false)
			return
		}
	} else {
		var message types.Json
		err = jsonorder.Unmarshal(body, &message)
		if err != nil {
			rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "error parsing message", false, fmt.Errorf("%v: %s", err, string(body)), true, true, false)
			return
		}
		messages = append(messages, message)
	}
	for _, message := range messages {
		messageId := message.GetS("eventn_ctx_event_id")
		if messageId == "" {
			messageId = uuid.New()
		} else {
			messageId = utils.ShortenString(messageIdUnsupportedChars.ReplaceAllString(messageId, "_"), 64)
		}
		c.Set(appbase.ContextMessageId, messageId)

		var ingestMessageBytes []byte
		var asyncDestinations []string
		_, ingestMessageBytes, err = r.buildIngestMessage(c, messageId, message, nil, "classic", loc, stream, patchClassicEvent, "")
		if err != nil {
			rError = r.ResponseError(c, utils.Ternary(s2sEndpoint, http.StatusBadRequest, http.StatusOK), "event error", false, err, true, true, false)
		} else if len(stream.AsynchronousDestinations) == 0 {
			rError = r.ResponseError(c, http.StatusOK, ErrNoDst, false, fmt.Errorf("%s", stream.Stream.Id), true, true, true)
		} else {
			asyncDestinations, _, rError = r.sendToRotor(c, messageId, ingestMessageBytes, stream, true)
		}
		if len(ingestMessageBytes) > 0 {
			_ = r.backupsLogger.Log(utils.DefaultString(metricsId, "UNKNOWN"), ingestMessageBytes)
		}
		if rError != nil && rError.ErrorType != ErrNoDst {
			obj := map[string]any{"body": string(ingestMessageBytes), "error": rError.PublicError.Error(), "status": utils.Ternary(rError.ErrorType == ErrThrottledType, "SKIPPED", "FAILED")}
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeIncoming, Level: eventslog.LevelError, ActorId: metricsId, Event: obj})
			IngestHandlerRequests(domain, utils.Ternary(rError.ErrorType == ErrThrottledType, "throttled", "error"), rError.ErrorType).Inc()
			_ = r.producer.ProduceAsync(r.config.KafkaDestinationsDeadLetterTopicName, uuid.New(), utils.TruncateBytes(ingestMessageBytes, r.config.MaxIngestPayloadSize), map[string]string{"error": rError.Error.Error()}, kafka2.PartitionAny, messageId, false, 0)
		} else {
			obj := map[string]any{"body": string(ingestMessageBytes), "asyncDestinations": asyncDestinations}
			if len(asyncDestinations) > 0 {
				obj["status"] = "SUCCESS"
			} else {
				obj["status"] = "SKIPPED"
				obj["error"] = ErrNoDst
			}
			r.eventsLogService.PostAsync(&eventslog.ActorEvent{EventType: eventslog.EventTypeIncoming, Level: eventslog.LevelInfo, ActorId: metricsId, Event: obj})
			IngestHandlerRequests(domain, "success", "").Inc()
		}
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
	return
}

func patchClassicEvent(c *gin.Context, messageId string, ev types.Json, _ string, ingestType IngestType, _ types.Json, _ string) error {
	ip := strings.TrimSpace(strings.Split(utils.NvlString(c.GetHeader("X-Real-Ip"), c.GetHeader("X-Forwarded-For"), c.ClientIP()), ",")[0])
	ipPolicy := c.Query(IPPolicyParameter)
	switch ipPolicy {
	case StrictValue, ComplyValue:
		ip = ipStripLastOctet(ip)
	}

	if ingestType == IngestTypeBrowser {
		//if ip comes from browser, don't trust it!
		if ip != "" {
			ev.Set("source_ip", ip)
		}
		ev.SetIfAbsentFunc("user_agent", func() any {
			return c.GetHeader("User-Agent")
		})
		ev.SetIfAbsentFunc("user_language", func() any {
			return strings.TrimSpace(strings.Split(c.GetHeader("Accept-Language"), ",")[0])
		})
		// remove any jitsu special properties from ingested events
		// it is only allowed to be set via functions
		types.FilterEvent(ev)
	}
	nowIsoDate := time.Now().UTC().Format(timestamp.JsonISO)
	ev.Set("_timestamp", nowIsoDate)
	ev.Set(APIKeyName, c.GetString("_classic_api_key"))
	ev.SetIfAbsent("utc_time", nowIsoDate)
	ev.SetIfAbsent("eventn_ctx_event_id", messageId)
	return nil
}
