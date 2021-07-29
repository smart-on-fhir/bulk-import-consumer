(function($) {

    function equals(a, b) {
        if (Array.isArray(a)) {
            if (!Array.isArray(b) || a.length !== b.length) {
                return false;
            }
            return a.every((x, i) => equals(x, b[i]));
        }

        if (a && typeof b == "object") {
            if (!b || typeof b != "object") {
                return false;
            }
            if (!equals(Object.keys(a), Object.keys(b))) {
                return false;
            }
            return Object.keys(a).every(key => equals(a[key], b[key]));
        }

        return a === b;
    }

    /**
     * Class Event - used for firing custom events
     */
    class Event
    {
        /**
         * @private
         */
        _isDefaultPrevented = false;
        
        /**
         * @private
         */
        _isPropagationStopped = false;

        /**
         * @type string
         * @readonly
         */
        type;

        /**
         * @type any
         */
        data;

        /**
         * @param {string} type 
         * @param {any} data 
         */
        constructor(type, data) {
            this.type = type;
            this.data = data;
        }

        stopPropagation() {
            this._isPropagationStopped = true;
        }

        preventDefault() {
            this._isDefaultPrevented = true; 
        }

        isPropagationStopped() {
            return this._isPropagationStopped; 
        };

        isDefaultPrevented() {
            return this._isDefaultPrevented;
        };
    }

    /**
     * Class Observable - base class for observable objects
     */
    class Observable
    {
        /**
         * @private
         */
        _listeners = {};
    
        /**
         * @param {Event} event
         */
        dispatch(event) {
            var list = this._listeners[event.type] || [], len = list.length, i;
            for (i = 0; i < len; i += 1) {
                list[i](event);
                if (event.isPropagationStopped()) {
                    break;
                }
            }
            return !event.isDefaultPrevented();
        }

        /**
         * Adds new event listener
         * @param {string} types
         * @param {Function} handler 
         */
        on(types, handler) {
            String(types || "").trim().split(/\s+/).forEach(type => {
                if (!this._listeners[type]) {
                    this._listeners[type] = [];
                }
                this._listeners[type].push(handler);
            });
        }

        /**
         * Removes event listener
         * @param {string|string[]} type 
         * @param {function} handler
         */
        off(type, handler) {
            if (Array.isArray(type)) {
                return type.forEach(t => this.off(t, handler));
            }

            type = String(type).trim();

            if (type.indexOf(" ") > -1) {
                return this.off(type.split(/\s+/), handler)
            }

            if (!type) {
                this._listeners = {};
            }
            else if (!handler) {
                this._listeners[type] = [];
            }
            else {
                this._listeners[type] = (this._listeners[type] || []).filter(f => f !== handler);
            }
        }
    }

    /**
     * Class Model
     */
    class Model extends Observable
    {
        /**
         * @type { Record<string, any> }
         */
        _data;

        constructor(data = {}) {
            super()
            this._data = data;
        }

        dump() {
            return JSON.stringify(this._data, null, 4);
        };

        /**
         * @param {string} name 
         */
        get(name) {
            return this._data[name];
        };

        /**
         * @param {string|Record<string, any>} name 
         * @param {any} [value] 
         */
        set(name, value) {

            if (name && typeof name == "object") {
                return Object.keys(name).forEach(key => this.set(key, name[key]));
            }

            var oldValue = this._data[name];
            
            if (equals(oldValue, value)) {
                return false;
            }

            this._data[name] = value;
                
            this.dispatch(new Event("change:" + name, {
                name    : name,
                oldValue: oldValue,
                newValue: value
            }));

            this.dispatch(new Event("change", {
                name    : name,
                oldValue: oldValue,
                newValue: value
            }));

            return true;
        };
    }

    // ---------------------------------------------------------------------- //
    //                                 APP                                    //
    // ---------------------------------------------------------------------- //
    const model = new Model();

    function generateKeys() {
        model.set("loading", true)
        $.getJSON("/generator?alg=" + model.get("alg")).done(json => {
            model.set({
                generatedPublicJWK : json.publicAsJWK,
                generatedPrivateJWK: json.privateAsJWK,
                generatedPublicPEM : json.publicAsPEM,
                generatedPrivatePEM: json.privateAsPEM
            })
        }).always(() => {
            model.set("loading", false)
        })
    }

    /**
     * @param {string} str The input string
     * @throws {Error} If the input is empty, not JSON or has no alg property
     */
    function validateJWK(str) {
        const jwk = JSON.parse(String(str || "null").trim())
        if (!jwk || !jwk.alg || typeof jwk.alg !== "string") {
            throw new Error("Invalid JWK")
        }
    }

    /**
     * @param {string} str The input string
     * @throws {Error} If the input is not a valid URL
     */
    function validateURL(str) {
        const url = String(str || "").trim()
        if (!/^https?\:\/\/.+/.test(url)) {
            throw new Error("Invalid URL")
        }
    }

    function checkFormStatus() {
        const keyType = model.get("keyType")
        try {
            if (keyType === "jwks") {
                validateJWK($("#jwk").val())
            }
            else if (keyType === "jwks-url") {
                validateURL($("#jwks_uri").val())
            }
            else {
                throw new Error("Unknown keyType")
            }
            $("[type='submit']").prop("disabled", false)
        } catch {
            $("[type='submit']").prop("disabled", true)
        }
    }

    function register(e) {
        e.preventDefault()
        if (!e.target.checkValidity()) {
            return;
        }

        const keyType = model.get("keyType")
        const body = {};

        if (keyType === "jwks-url") {
            body.jwks_uri = model.get("jwks_uri");
        } else {
            const jwk = JSON.parse(model.get("jwk") || "null")
            if (jwk) {
                body.jwks = { keys: [ jwk ] };
            }
        }

        model.set("loading", true)
        $.post({
            url: "/auth/register",
            contentType: "application/json",
            data: JSON.stringify(body)
        })
        .done((client) => {
            console.log(client)
            model.set({
                client_id: client.client_id,
                token_endpoint: client.token_endpoint
            })
        })
        .fail((jqXHR, textStatus, errorThrown) => {
            console.log(errorThrown || textStatus, jqXHR.responseJSON.error_description)
        })
        .always(() => {
            model.set("loading", false)
        })
    }


    // Begin Data listeners ----------------------------------------------------
    model.on("change:loading", (e) => {
        $("fieldset").prop("disabled", e.data.newValue === true)
    })

    model.on("change:keyType", (e) => {
        const { newValue } = e.data;
        $("#form-section-jwks-url").toggle(newValue === "jwks-url")
        $("#form-section-jwks").toggle(newValue === "jwks")
        $("#keyTypeJWKS").prop("checked", newValue === "jwks")
        $("#keyTypeJWKSURL").prop("checked", newValue === "jwks-url")
        $("#paste-key").prop("disabled", newValue !== "jwks" || !model.get("generatedPublicJWK"))
    })

    model.on("change:generatedKeysDisplayType", e => {
        $('[name="generated-key-type"]').each((i, o) => {
            $(o).prop("checked", $(o).data("value") === e.data.newValue)
        })
        $("#generated-public-key").val(
            e.data.newValue === "jwk" ?
                JSON.stringify(model.get("generatedPublicJWK"), null, 4) :
                model.get("generatedPublicPEM")
        )
        $("#generated-private-key").val(
            e.data.newValue === "jwk" ?
                JSON.stringify(model.get("generatedPrivateJWK"), null, 4) :
                model.get("generatedPrivatePEM")
        )
    })

    model.on("change:jwk", e => {
        $("#jwk").val(e.data.newValue)
    })

    model.on("change:alg", e => {
        $("#alg").val(e.data.newValue)
    })

    model.on("change:client_id", e => {
        $("#client_id").val(e.data.newValue)
    })
    
    model.on("change:token_endpoint", e => {
        $("#token_endpoint").val(e.data.newValue)
    })

    model.on("change:client_id change:token_endpoint", () => {
        const hasClient = (model.get("client_id") && model.get("token_endpoint"));
        $("#registration-section").toggle(!hasClient)
        $("#client-section").toggle(!!hasClient)
    })
    
    model.on("change:token_endpoint", e => {
        $("#token_endpoint").val(e.data.newValue)
    })

    model.on("change:generatedPublicJWK", e => {
        if (model.get("generatedKeysDisplayType") === "jwk") {
            $("#generated-public-key").val(
                e.data.newValue ? JSON.stringify(e.data.newValue, null, 4) : ""
            )
        }
        $("#paste-key").prop("disabled", !e.data.newValue || model.get("keyType") !== "jwks")
    })

    model.on("change:generatedPrivateJWK", e => {
        if (model.get("generatedKeysDisplayType") === "jwk") {
            $("#generated-private-key").val(
                e.data.newValue ? JSON.stringify(e.data.newValue, null, 4) : ""
            )
        }
    })

    model.on("change:generatedPublicPEM", e => {
        if (model.get("generatedKeysDisplayType") === "pem") {
            $("#generated-public-key").val(e.data.newValue)
        }
    })

    model.on("change:generatedPrivatePEM", e => {
        if (model.get("generatedKeysDisplayType") === "pem") {
            $("#generated-private-key").val(e.data.newValue)
        }
    })

    model.on("change:showGenerator", e => {
        $("#generator").toggle(!!e.data.newValue)
    })

    model.on("change:showGenerator", (e) => {
        $("#show-generator").prop("checked", e.data.newValue)
    })

    // model.on("change", () => console.log(model.dump()))

    // End Data Listeners ------------------------------------------------------

    // UI listeners ------------------------------------------------------------

    $("#keyTypeJWKS").on("click", () => {
        model.set("keyType", "jwks")
        checkFormStatus()
    })

    $("#keyTypeJWKSURL").on("click", () => {
        model.set("keyType", "jwks-url")
        checkFormStatus()
    })

    $("#jwks_uri").on("input", e => {
        model.set("jwks_uri", e.target.value)
        checkFormStatus()
    })
    
    $("#jwk").on("input", function(e) { 
        try {
            validateJWK(this.value)
            model.set("jwk", this.value)
            this.setCustomValidity("")
        } catch (ex) {
            console.log(ex.message)
            this.setCustomValidity(ex.message)
        }
        this.parentElement.classList.add("was-validated")
        checkFormStatus()
    })

    $("#alg").on("change", e => model.set("alg", $(e.target).val()))

    $("#generate").on("click", generateKeys)

    $('[name="generated-key-type"]').on("change", e => {
        model.set("generatedKeysDisplayType", $('[name="generated-key-type"]:checked').data("value"))
    })

    $("#paste-key").on("click", () => {
        const key = model.get("generatedPublicJWK")
        if (key) {
            model.set("jwk", JSON.stringify(key, null, 4))
            checkFormStatus()
        }
    })

    $("#clear-client").on("click", () => {
        model.set({
            client_id: "",
            token_endpoint: "",
            generatedPublicJWK: "",
            generatedPrivateJWK: "",
            generatedPublicPEM: "",
            generatedPrivatePEM: "",
            showGenerator: false,
            jwk: ""
        })
    })

    $("#show-generator").on("click", () => {
        model.set("showGenerator", !!$("#show-generator").prop("checked"))
    })

    $("form").on("submit", register)

    // End UI Listeners --------------------------------------------------------

    // INIT --------------------------------------------------------------------
    model.set({
        keyType: "jwks",
        generatedKeysDisplayType: "jwk",
        alg: "ES384",
        loading: false,
        client_id: "",
        token_endpoint: "",
        generatedPublicJWK: "",
        generatedPrivateJWK: "",
        generatedPublicPEM: "",
        generatedPrivatePEM: "",
        showGenerator: false,
        jwk: ""
    });

    checkFormStatus()    

})(jQuery);
