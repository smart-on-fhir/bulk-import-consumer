"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BulkDataClient = void 0;
const util_1 = __importDefault(require("util"));
const node_jose_1 = __importDefault(require("node-jose"));
const request_1 = __importDefault(require("./request"));
const lib_1 = require("./lib");
const CustomError_1 = require("./CustomError");
const OperationOutcome_1 = require("./OperationOutcome");
const auth_1 = require("./auth");
const config_1 = __importDefault(require("./config"));
const debug = util_1.default.debuglog("app");
const debugOutgoingAuth = util_1.default.debuglog("app-auth-outgoing");
class BulkDataClient {
    constructor(options) {
        this.accessToken = "";
        this._aborted = false;
        /**
         * A reference to the cancelable authorization request promise. This will
         * only be set while the authorization request is pending. Used by the
         * `cancel` method to abort the authorization request if it is currently
         * running.
         */
        this.authRequest = null;
        /**
         * A reference to the cancelable kick-off request promise. This will only be
         * set while the kick-off request is pending. Used by the `cancel` method to
         * abort the kick-off request if it is currently running.
         */
        this.kickOffRequest = null;
        /**
         * A reference to the cancelable status request promise. This will only be
         * set while the status request is pending. Used by the `cancel` method to
         * abort the status request if it is currently running.
         */
        this.statusRequest = null;
        /**
         * Multiple file download streams may exist. We store references to them
         * here so that we can destroy them on abort
         */
        this.downloadStreams = new Set();
        this.id = node_jose_1.default.util.randomBytes(8).toString("hex");
        this.abortController = new AbortController();
        this.options = {
            privateKey: config_1.default.privateKey,
            accessTokenLifetime: config_1.default.accessTokensExpireIn * 60,
            ...options
        };
        this.request = request_1.default.extend({
            context: {
                authorize: async () => {
                    this.accessToken = this._aborted ? "" : await this.getAccessToken();
                    return this.accessToken;
                }
            },
            headers: {
                authorization: `Bearer ${this.accessToken}`
            }
        });
        BulkDataClient.instances[this.id] = this;
    }
    /**
     * Get a BulkDataClient instance by its ID
     */
    static getInstance(id) {
        const instance = BulkDataClient.instances[id];
        if (!instance) {
            throw new CustomError_1.CustomError(410, "Cannot find the Bulk Data Client instance corresponding to " +
                "this import job. Perhaps the server was restarted and lost " +
                "its runtime state. Please try running the import again.");
        }
        return instance;
    }
    get aborted() {
        return this._aborted;
    }
    destroy() {
        this.debug("Destroying the instance");
        delete BulkDataClient.instances[this.id];
    }
    debug(message, ...rest) {
        debug("BulkDataClient#%s: " + message, this.id, ...rest);
    }
    async cancel(reason = "Import canceled") {
        this.debug("aborting...");
        this._aborted = true;
        // Abort wait timeouts (if any)
        this.debug("aborting wait timeouts");
        this.abortController.abort();
        // Abort authorization request (if pending)
        if (this.authRequest) {
            this.debug("aborting authorization request");
            this.authRequest.cancel(reason);
            this.authRequest = null;
        }
        // Abort kick-off request (if pending)
        if (this.kickOffRequest) {
            this.debug("aborting kick-off request");
            this.kickOffRequest.cancel(reason);
            this.kickOffRequest = null;
        }
        // Abort status request (if pending)
        if (this.statusRequest) {
            this.debug("aborting status request");
            this.statusRequest.cancel(reason);
            this.statusRequest = null;
        }
        // Abort downloads (if any)
        this.downloadStreams.forEach(stream => {
            this.debug("aborting download from %s", stream.options.url.href);
            this.downloadStreams.delete(stream);
            stream.destroy();
        });
    }
    /**
     * Gets an access token from the Data Provider
     */
    async getAccessToken() {
        const options = {
            clientId: this.options.clientId,
            privateKey: this.options.privateKey,
            baseUrl: this.options.providerBaseUrl,
            accessTokenLifetime: this.options.accessTokenLifetime
        };
        this.debug("Making authorization request to the data provider");
        debugOutgoingAuth("Authorizing at data provider with options:", options);
        const { request } = await auth_1.authorize(options);
        this.authRequest = request;
        const { body } = await this.authRequest;
        debugOutgoingAuth("Received access token response from data provider:", body);
        this.debug("Completed authorization request to data provider");
        this.authRequest = null;
        return body.access_token || "";
    }
    async kickOff(kickOffUrl, params = {}) {
        const body = {
            resourceType: "Parameters",
            parameter: []
        };
        // _since (single valueInstant parameter) ------------------------------
        if (params._since) {
            body.parameter.push({
                name: "_since",
                valueInstant: params._since
            });
        }
        // _outputFormat (single valueString parameter) ------------------------
        if (params._outputFormat) {
            body.parameter.push({
                name: "_outputFormat",
                valueString: params._outputFormat
            });
        }
        // patient (sent as one or more valueReference params) -----------------
        if (params.patient) {
            body.parameter = body.parameter.concat(lib_1.asArray(params.patient).map((id) => ({
                name: "patient",
                valueReference: { reference: `Patient/${id}` }
            })));
        }
        // _type (sent as one or more valueString params) ----------------------
        if (params._type) {
            body.parameter = body.parameter.concat(lib_1.asArray(params._type).map((type) => ({
                name: "_type",
                valueString: type
            })));
        }
        // _elements (sent as one or more valueString params) ------------------
        if (params._elements) {
            body.parameter = body.parameter.concat(lib_1.asArray(params._elements).map((type) => ({
                name: "_elements",
                valueString: type
            })));
        }
        // _typeFilter (sent as one or more valueString params) ----------------
        if (params._typeFilter) {
            body.parameter = body.parameter.concat(lib_1.asArray(params._typeFilter).map((type) => ({
                name: "_typeFilter",
                valueString: type
            })));
        }
        // includeAssociatedData (sent as one or more valueString params) ------
        if (params.includeAssociatedData) {
            body.parameter = body.parameter.concat(lib_1.asArray(params.includeAssociatedData).map((type) => ({
                name: "includeAssociatedData",
                valueString: type
            })));
        }
        // this._aborted = false
        this.debug("Making export kick-off request");
        this.kickOffRequest = this.request(kickOffUrl, {
            json: body,
            method: "POST",
            followRedirect: false,
            headers: {
                accept: "application/fhir+json",
                prefer: "respond-async"
            }
        });
        return this.kickOffRequest.then(res => {
            this.debug("Completed export kick-off request");
            this.kickOffRequest = null;
            return res;
        });
    }
    async waitForExport(kickOffResponse, onProgress) {
        if (this._aborted) {
            throw new CustomError_1.CustomError(410, "The export has been canceled by the client");
        }
        this.debug("Waiting for export");
        const contentLocation = kickOffResponse.headers["content-location"] + "";
        if (!contentLocation) {
            throw new CustomError_1.CustomError(400, "Trying to wait for export but the kick-off " +
                "response did not include a content-location header.");
        }
        this.statusRequest = this.fetchExportManifest(contentLocation);
        const { body, statusCode, headers } = await this.statusRequest;
        this.statusRequest = null;
        if (!this._aborted && statusCode !== 200) {
            onProgress && await onProgress(parseFloat(headers["x-progress"] + "" || "0"));
            await lib_1.wait(1000, this.abortController.signal);
            return this.waitForExport(kickOffResponse, onProgress);
        }
        await lib_1.wait(100, this.abortController.signal);
        onProgress && await onProgress(100);
        return body;
    }
    /**
     * This is used for both static and dynamic imports.
     * - For static, `location` is the URL of the already available export
     *   manifest json.
     * - For dynamic, `location` is the URL of the job status endpoint. If
     *   export is still in progress this will resolve with 202 responses and
     *   should be called again until status 200 is received
     */
    fetchExportManifest(location) {
        if (this._aborted) {
            throw new CustomError_1.CustomError(410, "The export has been canceled by the client");
        }
        return this.request(location, {
            responseType: "json",
            headers: {
                authorization: `Bearer ${this.accessToken}`
            }
        });
    }
    downloadFile(descriptor) {
        if (this._aborted) {
            throw new lib_1.AbortError("The export has been canceled by the client");
        }
        const out = {
            stream: () => {
                const stream = this.request.stream(descriptor.url, {
                    headers: {
                        authorization: `Bearer ${this.accessToken}`
                    }
                });
                this.downloadStreams.add(stream);
                stream.once("close", () => {
                    this.downloadStreams.delete(stream);
                });
                stream.once("readable", () => {
                    this.debug("Downloading file %s", descriptor.url);
                });
                return stream;
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
BulkDataClient.instances = {};
