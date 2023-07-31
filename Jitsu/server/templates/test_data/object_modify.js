if ($.event_type === 'app_page' || $.event_type === 'site_page' || $.event_type === 'user_identify') {
    $.event_type = "app";
}  else if ($.user?.email && ($.user?.email.endsWith('@jitsu.com') || $.user?.email.endsWith('@ksense.io'))) {
    $.event_type = "jitsu";
} else {
    $.event_type = "skipped";
} 
return $;