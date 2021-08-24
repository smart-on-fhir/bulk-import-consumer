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
                debug(`-------------------------------------------------------`)
                debug(`Request: ${options.method} ${options.url}`)
                debug(`Headers:`, options.headers)

                const payload = options.body || options.form || options.json
                if (payload) {
                    debug("Payload:", payload)
                }
            }
        ],
        afterResponse: [
            async (response, retryWithMergedOptions) => {
                debug(`Response status:`, response.statusCode, response.statusMessage)
                debug(`Response Headers:`, response.headers)
                if (response.body) {
                    debug(`Response:`, response.body)
                }
                debug(`-------------------------------------------------------`)

                // Unauthorized
                if (response.statusCode === 401 &&
                    !response.request.options.context.retried &&
                    typeof response.request.options.context.authorize == "function")
                {
                    // Refresh the access token
                    const token = await response.request.options.context.authorize()
                    const updatedOptions = {
                        headers: {
                            authorization: `bearer ${token}`
                        },
                        context: {
                            retried: true
                        }
                    };

                    // Update the defaults
                    got.mergeOptions(response.request.options, updatedOptions);

                    // Make a new retry
                    return retryWithMergedOptions(updatedOptions);
                }

                return response
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