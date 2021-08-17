let event_type1 = $.event_type || null;
let event_type2 = $.event_type?.toUpperCase() || null;
var email;
if (event_type1 === 'important') {
    email = $.user?.email
}

return { event_type1, event_type2, email }
