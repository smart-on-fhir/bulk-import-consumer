import got  from "got/dist/source"
import util from "util"

const debug = util.debuglog("app-request")


/**
 * A pre-configured request with the following custom options:
 * - `context.authorize` - A function that will be called in case of 401 response to retry with fresh token
 * - `context.retried`   - Set internally to skip multiple auth retries
 * Also, any errors will be caught and if necessary decorated with OperationOutcome or OAuth properties.
 * Finally, to debug log requests start the process with NODE_DEBUG="app-request" (or "app-*") env variable
 */
 export default got.extend({
    hooks: {
        beforeRequest: [
            options => {
                options.headers["user-agent"] = "Bulk Data Import Consumer <https://github.com/smart-on-fhir/bulk-import-consumer>"
        
                if (options.isStream) {
                    const payload = options.body || options.form || options.json
                    debug(
                        "\n╭────────────────────────────────────────────────────────────────╌┄┈" +
                        "\nRequest: %s %s\nRequest Headers: %o\n\nRequest Payload: %o" +
                        "\nResponse: STREAMING..." +
                        "\n╰────────────────────────────────────────────────────────────────╌┄┈",
                        options.method,
                        options.url,
                        options.headers,
                        payload
                    )
                    // debug(`Response: streaming...`)
                }
            }
        ],
        afterResponse: [
            (response, retryWithMergedOptions) => {
                const { options } = response.request;

                const payload = options.body || options.form || options.json

                debug(
                    "\n╭────────────────────────────────────────────────────────────────╌┄┈" +
                    "\nRequest: %s %s\nRequest Headers: %o\n\nRequest Payload: %o" +
                    "\nResponse Status: %s %s\nResponse Headers: %o\n\nResponse Payload: %o" +
                    "\n╰────────────────────────────────────────────────────────────────╌┄┈",
                    options.method,
                    options.url,
                    options.headers,
                    payload,
                    response.statusCode,
                    response.statusMessage,
                    response.headers,
                    response.body
                )

                // Handle transient errors by automatically retrying up to 3 times.
                if (response.body && typeof response.body == "object") {
                        
                    // @ts-ignore OperationOutcome errors
                    if (response.body.resourceType === "OperationOutcome") {
                        const oo = response.body as fhir4.OperationOutcome
                        if (oo.issue.every(i => i.code === 'transient')) {
                            let msg = oo.issue.map(i => i.details?.text || i.diagnostics).filter(Boolean);
                            console.log("The server replied with transient error(s)")
                            if (msg) {
                                console.log("- " + msg.join("\n- "))
                            }
                            return retryWithMergedOptions(options);
                        }
                    }
                }

                return response
            }
        ],
        beforeRetry: [
			(error, retryCount) => {
                if (+retryCount > 3) {
                    throw new Error(`Request failed in ${retryCount} attempts. ${error}`)
                }
				// console.log(`Retrying [${retryCount}]: ${error.code}`);
				// Retrying [1]: ERR_NON_2XX_3XX_RESPONSE
			}
		],
        beforeError: [
            error => {
                // console.log("beforeError:", error)
                const { response } = error;
                
                if (typeof response?.body == "object") {
                    
                    // @ts-ignore OperationOutcome errors
                    if (response.body.resourceType === "OperationOutcome") {
                        const oo = response.body as fhir4.OperationOutcome
                        // @ts-ignore
                        error.severity = oo.issue[0].severity;
                        error.message = oo.issue[0].details?.text || oo.issue[0].diagnostics || response.statusMessage || "Unknown error"
                        error.code = oo.issue[0].code || response.statusCode + ""
                    }

                    // @ts-ignore OAuth errors
                    else if (response.body.error) {
                        // @ts-ignore
                        error.message = [response.body.error, response.body.error_description].filter(Boolean).join(": ")
                        error.code = response.statusCode + ""
                    }
                }

                return error;
            }
        ]
    }
});
