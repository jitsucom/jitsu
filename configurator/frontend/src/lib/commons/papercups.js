/* eslint-disable */
import {User} from "../services/model";

function loadScript(src, async, defer) {
    const script = document.createElement("script");
    script.src = src;
    script.async = !!async;
    script.defer = !!defer;
    document.body.appendChild(script);
}

const PapercupsWrapper = {
    init: function (user, enableStorytime) {
        let customer = {
            name: user.name,
            email: user.email,
            external_id: user.id,
        };
        //console.log("Papercups customer", customer);
        window.Papercups = {
            config: {
                accountId: "ebbac26e-4997-4165-a0bc-d05732f28a76",
                title: "Welcome to Jitsu!",
                subtitle: "Ask us anything",
                primaryColor: "#27a4fb",
                greeting: 'Hi there! How can I help you?',
                newMessagePlaceholder: "Start typing...",
                baseUrl: "https://app.papercups.io",
                customer
            },
        };
        loadScript("https://app.papercups.io/widget.js", true, true)
        if (enableStorytime) {
            loadScript("https://app.papercups.io/storytime.js", true, true)
        }
    },
    focusWidget() {
        window.dispatchEvent(new Event('papercups:open'));
    }
}

export default PapercupsWrapper;


