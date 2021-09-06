import util                          from "util"
import jose                          from "node-jose"
import { Got, Response }             from "got"
import { Writable }                  from "stream"
import { Parameters }                from "fhir/r4"
import got                           from "./request"
import { AbortError, asArray, wait } from "./lib"
import { CustomError }               from "./CustomError"
import { OperationOutcome }          from "./OperationOutcome"
import { BulkData, ImportServer }    from "../types"
import { authorize }                 from "./auth"
import config                        from "./config"

const debug = util.debuglog("app")
const debugOutgoingAuth = util.debuglog("app-auth-outgoing")

interface BulkDataClientConstructorOptions {
    /**
     * The `client_id` of the data consumer (which is registered as client of
     * the Data Provider)
     */
     clientId: string

     /**
      * The base URL of the DataProvider FHIR server. Used to look up .well-known
      * /smart-configuration or metadata and detect what the token endpoint is
      * (needed for authorization)
      */
     providerBaseUrl: string
 
     /**
      * Desired access tokens lifetime in seconds. Defaults to 300 (5 min)
      */
     accessTokenLifetime?: number
 
     /**
      * The private key that we use to sign our authentication tokens
      */
     privateKey?: ImportServer.JWK
}
interface BulkDataClientOptions extends BulkDataClientConstructorOptions {

    /**
     * Desired access tokens lifetime in seconds. Defaults to 300 (5 min)
     */
    accessTokenLifetime: number

    /**
     * The private key that we use to sign our authentication tokens
     */
    privateKey: ImportServer.JWK
}

export class BulkDataClient
{
    private static instances: { [id: string]: BulkDataClient } = {};

    public readonly id: string;

    options: BulkDataClientOptions;

    private accessToken: string = "";

    private request: Got;

    private _aborted: boolean = false;

    /**
     * An AbortController instance that we use to pass abort signals to cancel
     * any pending wait timeouts
     */
    private abortController: AbortController;

    /**
     * Get a BulkDataClient instance by its ID
     */
    public static getInstance(id: string)
    {
        const instance = BulkDataClient.instances[id]
        if (!instance) {
            throw new CustomError(
                410,
                "Cannot find the Bulk Data Client instance corresponding to " +
                "this import job. Perhaps the server was restarted and lost " +
                "its runtime state. Please try running the import again."
            );
        }
        return instance;
    }

    get aborted() {
        return this._aborted
    }

    constructor(options: BulkDataClientConstructorOptions)
    {
        this.id = jose.util.randomBytes(8).toString("hex");
        this.abortController = new AbortController()

        this.options = {
            privateKey: config.privateKey,
            accessTokenLifetime: config.accessTokensExpireIn * 60,
            ...options
        };

        this.request = got.extend({
            context: {
                authorize: async () => {
                    this.accessToken = this._aborted ? "" : await this.getAccessToken();
                    return this.accessToken
                }
            },
            headers: {
                authorization: `Bearer ${ this.accessToken }`
            }
        });

        BulkDataClient.instances[this.id] = this
    }

    destroy() {
        this.debug("Destroying the instance")
        delete BulkDataClient.instances[this.id]
    }

    private debug(message: string, ...rest: any[]) {
        debug("BulkDataClient#%s: " + message, this.id, ...rest)
    }

    public async cancel()
    {
        this.debug("aborting...")
        this._aborted = true
        this.abortController.abort()
    }

    /**
     * Gets an access token from the Data Provider
     */
    async getAccessToken(): Promise<string>
    {
        const options = {
            clientId           : this.options.clientId,
            privateKey         : this.options.privateKey,
            baseUrl            : this.options.providerBaseUrl,
            accessTokenLifetime: this.options.accessTokenLifetime
        };

        this.debug("Making authorization request to the data provider")
        debugOutgoingAuth("Authorizing at data provider with options:", options)

        const { request } = await authorize(options);
        
        const abort = () => {
            this.debug("aborting authorization request")
            request.cancel()
        };

        this.abortController.signal.addEventListener("abort", abort, { once: true });

        return request.then(res => {
            const { body } = res
            debugOutgoingAuth("Received access token response from data provider:", body)
            this.debug("Completed authorization request to data provider")
            return body.access_token || ""
        }).finally(() => {
            this.abortController.signal.removeEventListener("abort", abort);
        });
    }

    /**
     * Makes a kick-off export request to the Data Provider's export endpoint.
     * Used for initiating dynamic imports.
     */
    async kickOff(kickOffUrl: string, params: BulkData.KickOfParams = {}): Promise<BulkData.KickOffResponse>
    {
        const body: Parameters = {
            resourceType: "Parameters",
            parameter: []
        }
        
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
            body.parameter = body.parameter.concat(
                asArray(params.patient).map((id: any) => ({
                    name : "patient",
                    valueReference : { reference: `Patient/${id}` }
                }))
            );
        }

        // _type (sent as one or more valueString params) ----------------------
        if (params._type) {
            body.parameter = body.parameter.concat(
                asArray(params._type).map((type: any) => ({
                    name: "_type",
                    valueString: type
                }))
            );
        }

        // _elements (sent as one or more valueString params) ------------------
        if (params._elements) {
            body.parameter = body.parameter.concat(
                asArray(params._elements).map((type: any) => ({
                    name: "_elements",
                    valueString: type
                }))
            );
        }

        // _typeFilter (sent as one or more valueString params) ----------------
        if (params._typeFilter) {
            body.parameter = body.parameter.concat(
                asArray(params._typeFilter).map((type: any) => ({
                    name: "_typeFilter",
                    valueString: type
                }))
            );
        }

        // includeAssociatedData (sent as one or more valueString params) ------
        if (params.includeAssociatedData) {
            body.parameter = body.parameter.concat(
                asArray(params.includeAssociatedData).map((type: any) => ({
                    name: "includeAssociatedData",
                    valueString: type
                }))
            );
        }

        this.debug("Making export kick-off request")

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
            this.debug("aborting kick-off request")
            request.cancel()
        };

        this.abortController.signal.addEventListener("abort", abort, { once: true });

        return request.then(res => {
            this.debug("Completed export kick-off request")
            return res
        }).finally(() => {
            this.abortController.signal.removeEventListener("abort", abort);
        });
    }

    async waitForExport(kickOffResponse: BulkData.KickOffResponse, onProgress?: (pct: number) => any): Promise<BulkData.ExportManifest>
    {
        if (this._aborted) {
            throw new CustomError(410, "The export has been canceled by the client");
        }

        this.debug("Waiting for export")
        
        const contentLocation = kickOffResponse.headers["content-location"] + "";

        if (!contentLocation) {
            throw new CustomError(
                400,
                "Trying to wait for export but the kick-off " +
                "response did not include a content-location header."
            );
        }

        const { body, statusCode, headers } = await this.fetchExportManifest(contentLocation);

        if (!this._aborted && statusCode !== 200) {
            onProgress && await onProgress(parseFloat(headers["x-progress"] + "" || "0"))
            await wait(1000, this.abortController.signal);
            return this.waitForExport(kickOffResponse, onProgress);
        }

        await wait(100, this.abortController.signal);
        onProgress && await onProgress(100)
        return body
    }

    /**
     * This is used for both static and dynamic imports.
     * - For static, `location` is the URL of the already available export
     *   manifest json.
     * - For dynamic, `location` is the URL of the job status endpoint. If
     *   export is still in progress this will resolve with 202 responses and
     *   should be called again until status 200 is received
     */
    fetchExportManifest(location: string): Promise<Response<BulkData.ExportManifest>>
    {
        if (this._aborted) {
            throw new CustomError(410, "The export has been canceled by the client");
        }

        const request = this.request<BulkData.ExportManifest>(location, {
            responseType: "json",
            headers: {
                authorization: `Bearer ${ this.accessToken }`
            }
        });

        const abort = () => {
            this.debug("aborting status request")
            request.cancel()
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
    downloadFileStream(descriptor: BulkData.ExportManifestFile)
    {
        if (this._aborted) {
            throw new AbortError("The export has been canceled by the client");
        }

        const stream = this.request.stream(descriptor.url, {
            headers: {
                authorization: `Bearer ${ this.accessToken }`
            }
        });

        const abort = () => {
            this.debug("aborting download from %s", descriptor.url)
            stream.destroy()
        };

        this.abortController.signal.addEventListener("abort", abort, { once: true });
        
        stream.once("end", () => {
            this.abortController.signal.removeEventListener("abort", abort);
        });

        stream.once("readable", () => {
            this.debug("Downloading file %s", descriptor.url)
        });

        return stream;
    }

    /**
     * This is a wrapper around `this.downloadFileStream()` that returns a
     * Promise which will be resolved once the download is complete.
     * A destination writable stream must also be provided. Otherwise the
     * download won't start and the promise will remain pending.
     */
    downloadFilePromise(descriptor: BulkData.ExportManifestFile, destination: Writable)
    {
        if (this._aborted) {
            throw new AbortError("The export has been canceled by the client");
        }

        return new Promise((resolve, reject) => {
            const source = this.downloadFileStream(descriptor);
            let pipeline: Writable = source.pipe(destination);
            pipeline.once("finish", resolve);
            pipeline.once("error", e => reject(new OperationOutcome(e.message, 500)));
        });
    }
}
