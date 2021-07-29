"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BulkDataClient = void 0;
const node_jose_1 = __importDefault(require("node-jose"));
const got_1 = __importDefault(require("got"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const lib_1 = require("./lib");
const CustomError_1 = require("./CustomError");
const OperationOutcome_1 = require("./OperationOutcome");
class BulkDataClient {
    constructor(options) {
        this.options = { verbose: true, ...options };
        this.request = got_1.default.extend({
            context: {
                verbose: this.options.verbose
            },
            hooks: {
                beforeRequest: [
                    options => {
                        if (options.context.verbose) {
                            console.log(`\n-----------------------------------------------------`);
                            console.log(`Request: ${options.method} ${options.url}`);
                            console.log(`Headers:`, options.headers);
                            const payload = options.body || options.form || options.json;
                            if (payload) {
                                console.log("Payload:", payload);
                            }
                        }
                    }
                ],
                afterResponse: [
                    async (response, retryWithMergedOptions) => {
                        if (response.request.options.context.verbose) {
                            console.log(`Response Headers:`, response.headers);
                            if (response.body) {
                                console.log(`Response:`, response.body);
                            }
                            console.log(`-----------------------------------------------------\n`);
                        }
                        // Unauthorized
                        if (response.statusCode === 401 && !response.request.options.context.retried) {
                            // Refresh the access token
                            const token = await this.authorize();
                            const updatedOptions = {
                                headers: {
                                    authorization: `bearer ${token}`
                                },
                                context: {
                                    retried: true
                                }
                            };
                            // Update the defaults
                            got_1.default.mergeOptions(response.request.options, updatedOptions);
                            // Make a new retry
                            return retryWithMergedOptions(updatedOptions);
                        }
                        return response;
                    }
                ],
                beforeError: [
                    error => {
                        const { response } = error;
                        if (typeof response?.body == "object") {
                            // @ts-ignore OperationOutcome errors
                            if (response.body.resourceType === "OperationOutcome") {
                                const oo = response.body;
                                // @ts-ignore
                                error.severity = oo.issue[0].severity;
                                error.message = oo.issue[0].details?.text || oo.issue[0].diagnostics || response.statusMessage || "Unknown error";
                                error.code = oo.issue[0].code || response.statusCode + "";
                            }
                            // @ts-ignore OAuth errors
                            else if (response.body.error) {
                                // @ts-ignore
                                error.message = [response.body.error, response.body.error_description].filter(Boolean).join(": ");
                                error.code = response.statusCode + "";
                            }
                        }
                        return error;
                    }
                ]
            }
        });
    }
    async authorize() {
        const { clientId, tokenUrl, accessTokenLifetime, privateKey } = this.options;
        const claims = {
            iss: clientId,
            sub: clientId,
            aud: tokenUrl,
            exp: Math.round(Date.now() / 1000) + accessTokenLifetime,
            jti: node_jose_1.default.util.randomBytes(10).toString("hex")
        };
        const key = await node_jose_1.default.JWK.asKey(privateKey, "json");
        const token = jsonwebtoken_1.default.sign(claims, key.toPEM(true), {
            algorithm: key.alg,
            keyid: key.kid
        });
        const { body } = await this.request(tokenUrl, {
            method: "POST",
            responseType: "json",
            form: {
                scope: "system/*.*",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: token
            }
        });
        return body.access_token;
    }
    async kickOff(kickOffUrl, params = {}) {
        const body = {
            resourceType: "Parameters",
            parameter: []
        };
        // _since (single valueInstant parameter) ----------------------------------
        if (params._since) {
            body.parameter.push({
                name: "_since",
                valueInstant: params._since
            });
        }
        // _outputFormat (single valueString parameter) ----------------------------
        if (params._outputFormat) {
            body.parameter.push({
                name: "_outputFormat",
                valueString: params._outputFormat
            });
        }
        // patient (sent as one or more valueReference params) ---------------------
        if (params.patient) {
            body.parameter = body.parameter.concat(lib_1.asArray(params.patient).map((id) => ({
                name: "patient",
                valueReference: { reference: `Patient/${id}` }
            })));
        }
        // _type (sent as one or more valueString params) --------------------------
        if (params._type) {
            body.parameter = body.parameter.concat(lib_1.asArray(params._type).map((type) => ({
                name: "_type",
                valueString: type
            })));
        }
        // _elements (sent as one or more valueString params) ----------------------
        if (params._elements) {
            body.parameter = body.parameter.concat(lib_1.asArray(params._elements).map((type) => ({
                name: "_elements",
                valueString: type
            })));
        }
        // _typeFilter (sent as one or more valueString params) --------------------
        if (params._typeFilter) {
            body.parameter = body.parameter.concat(lib_1.asArray(params._typeFilter).map((type) => ({
                name: "_typeFilter",
                valueString: type
            })));
        }
        // includeAssociatedData (sent as one or more valueString params) ----------
        if (params.includeAssociatedData) {
            body.parameter = body.parameter.concat(lib_1.asArray(params.includeAssociatedData).map((type) => ({
                name: "includeAssociatedData",
                valueString: type
            })));
        }
        if (!this.accessToken) {
            this.accessToken = await this.authorize();
        }
        return this.request(kickOffUrl, {
            json: body,
            method: "POST",
            followRedirect: false,
            // throwHttpErrors: false,
            headers: {
                accept: "application/fhir+json",
                prefer: "respond-async",
                authorization: `Bearer ${this.accessToken}`
            }
        });
    }
    async waitForExport(kickOffResponse, onProgress) {
        const contentLocation = kickOffResponse.headers["content-location"] + "";
        if (!contentLocation) {
            throw new CustomError_1.CustomError(400, "Trying to wait for export but the kick-off " +
                "response did not include a content-location header.");
        }
        if (!this.accessToken) {
            this.accessToken = await this.authorize();
        }
        const { body, statusCode, headers } = await this.request(contentLocation, {
            responseType: "json",
            headers: {
                authorization: `Bearer ${this.accessToken}`
            }
        });
        if (statusCode !== 200) {
            onProgress && await onProgress(parseFloat(headers["x-progress"] + "" || "0"));
            await lib_1.wait(1000);
            return this.waitForExport(kickOffResponse, onProgress);
        }
        await lib_1.wait(100);
        onProgress && await onProgress(100);
        return body;
    }
    downloadFile(descriptor) {
        const out = {
            stream: () => {
                return this.request.stream(descriptor.url, {
                    context: {
                        verbose: this.options.verbose
                    },
                    headers: {
                        authorization: `Bearer ${this.accessToken}`
                    }
                });
            },
            promise: (destination) => {
                return new Promise((resolve, reject) => {
                    const source = out.stream();
                    let pipeline = source.pipe(destination);
                    pipeline.once("finish", resolve);
                    pipeline.once("error", e => reject(new OperationOutcome_1.OperationOutcome(e.message, 500)));
                });
            }
        };
        return out;
    }
}
exports.BulkDataClient = BulkDataClient;
