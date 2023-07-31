return {
    "user_id":$.user?.id || null,
    "event_type1": $?.event_type || null,
    "event_type2": $.event_type?.toUpperCase() || null,
    "user": {
        "email": $.user?.email || null
    }
}