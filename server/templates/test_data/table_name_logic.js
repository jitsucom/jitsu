if (_.event_type === 'app_page' || $.event_type === 'site_page' || $.event_type === 'user_identify') {
    return "app";
} else if ($.doc_host && $.doc_host.endsWith('--jitsu-cloud.netlify.app')) {
    return null;
} else if ($.user?.email && ($.user?.email.endsWith('@jitsu.com') || $.user?.email.endsWith('@ksense.io'))) {
    return "";
} else if ($.user?.email && ($.user?.email.endsWith('@undefined.com') || $.user?.email.endsWith('@ksense.io'))) {
    return undefined;
}
return false;