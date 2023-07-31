($.event_type === 'app_page'
    // || event_type === 'site_page'
    // || event_type === 'user_identify'
     || ($.user?.email && $.user?.email.endsWith("@ksense.io")) ) ? "app" : $.event_type
    //  || (user?.email && user?.email.endsWith("@jitsu.com"))
    //  || (doc_host && doc_host.endsWith('--jitsu-cloud.netlify.app'))