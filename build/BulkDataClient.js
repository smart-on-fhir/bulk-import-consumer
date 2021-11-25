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
        /**
         * Every time we get new access token, we set this field based on the
         * token's expiration time.
         */
        this.accessTokenExpiresAt = 0;
        this._aborted = false;
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
    async cancel() {
        this.debug("aborting...");
        this._aborted = true;
        this.abortController.abort();
    }
    /**
     * Gets an access token from the Data Provider
     */
    async getAccessToken() {
        if (this.accessToken && this.accessTokenExpiresAt - 10 > Date.now() / 1000) {
            return this.accessToken;
        }
        const options = {
            clientId: this.options.clientId,
            privateKey: this.options.privateKey,
            baseUrl: this.options.providerBaseUrl,
            accessTokenLifetime: this.options.accessTokenLifetime
        };
        this.debug("Making authorization request to the data provider");
        debugOutgoingAuth("Authorizing at data provider with options:", options);
        const { request } = await auth_1.authorize(options);
        const abort = () => {
            this.debug("aborting authorization request");
            request.cancel();
        };
        this.abortController.signal.addEventListener("abort", abort, { once: true });
        return request.then(res => {
            const { body } = res;
            debugOutgoingAuth("Received access token response from data provider:", body);
            this.debug("Completed authorization request to data provider");
            this.accessToken = res.body.access_token || "";
            this.accessTokenExpiresAt = auth_1.getAccessTokenExpiration(res.body);
            return this.accessToken;
        }).finally(() => {
            this.abortController.signal.removeEventListener("abort", abort);
        });
    }
    /**
     * Makes a kick-off export request to the Data Provider's export endpoint.
     * Used for initiating dynamic imports.
     */
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
        this.debug("Making export kick-off request");
        const request = this.request(kickOffUrl, {
            json: body,
            method: "POST",
            followRedirect: false,
            headers: {
                accept: "application/fhir+json",
                prefer: "respond-async"
            }
        });
        const abort = () => {
            this.debug("aborting kick-off request");
            request.cancel();
        };
        this.abortController.signal.addEventListener("abort", abort, { once: true });
        return request.then(res => {
            this.debug("Completed export kick-off request");
            return res;
        }).finally(() => {
            this.abortController.signal.removeEventListener("abort", abort);
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
        const { body, statusCode, headers } = await this.fetchExportManifest(contentLocation);
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
        const request = this.request(location, {
            responseType: "json",
            headers: {
                authorization: `Bearer ${this.accessToken}`
            }
        });
        const abort = () => {
            this.debug("aborting status request");
            request.cancel();
        };
        this.abortController.signal.addEventListener("abort", abort, { once: true });
        return request.finally(() => {
            this.abortController.signal.removeEventListener("abort", abort);
        });
    }
    /**
     * Creates and returns a file download stream for provided file descriptor.
     * The download can be aborted by calling `this.cancel()`.
     * NOTE that the download won't begin until the returned stream is piped
     * to some destination stream.
     */
    downloadFileStream(descriptor) {
        if (this._aborted) {
            throw new lib_1.AbortError("The export has been canceled by the client");
        }
        const stream = this.request.stream(descriptor.url, {
            headers: {
                authorization: `Bearer ${this.accessToken}`
            }
        });
        const abort = () => {
            this.debug("aborting download from %s", descriptor.url);
            stream.destroy();
        };
        this.abortController.signal.addEventListener("abort", abort, { once: true });
        stream.once("end", () => {
            this.abortController.signal.removeEventListener("abort", abort);
        });
        stream.once("readable", () => {
            this.debug("Downloading file %s", descriptor.url);
        });
        return stream;
    }
    /**
     * This is a wrapper around `this.downloadFileStream()` that returns a
     * Promise which will be resolved once the download is complete.
     * A destination writable stream must also be provided. Otherwise the
     * download won't start and the promise will remain pending.
     */
    downloadFilePromise(descriptor, destination) {
        if (this._aborted) {
            throw new lib_1.AbortError("The export has been canceled by the client");
        }
        return new Promise((resolve, reject) => {
            const source = this.downloadFileStream(descriptor);
            let pipeline = source.pipe(destination);
            pipeline.once("finish", resolve);
            pipeline.once("error", e => reject(new OperationOutcome_1.OperationOutcome(e.message, 500)));
        });
    }
}
exports.BulkDataClient = BulkDataClient;
BulkDataClient.instances = {};
