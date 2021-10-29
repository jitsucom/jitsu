function JitsuTransformFunction($) {

    const context = $.eventn_ctx || $
    const user = context.user || {}


    return {
        event_name: $.event_type,
        event_id: context.event_id || $.eventn_ctx_event_id,
        event_source_url: context.url,
        user_data: {
            client_ip_address: $.source_ip,
            em: user.email,
            client_user_agent: context.user_agent
        }
    }
}