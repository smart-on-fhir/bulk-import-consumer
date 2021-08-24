import util                          from "util"
import jose                          from "node-jose"
import got                           from "./request"
import jwt                           from "jsonwebtoken"
import { Writable }                  from "stream"
import { Parameters }                from "fhir/r4"
import { AbortError, asArray, wait } from "./lib"
import { CustomError }               from "./CustomError"
import { OperationOutcome }          from "./OperationOutcome"
import { BulkData, ImportServer }    from "../types"
import { authorize }                 from "./auth"
import Request                       from "got/dist/source/core"
import { Got, Response, CancelableRequest } from "got"
import config from "./config"

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
     * A reference to the cancelable authorization request promise. This will
     * only be set while the authorization request is pending. Used by the
     * `cancel` method to abort the authorization request if it is currently
     * running.
     */
    private authRequest: CancelableRequest<Response<BulkData.TokenResponse>> | null = null;

    /**
     * A reference to the cancelable kick-off request promise. This will only be
     * set while the kick-off request is pending. Used by the `cancel` method to
     * abort the kick-off request if it is currently running.
     */
     private kickOffRequest: CancelableRequest<Response<any>> | null = null;

    /**
     * A reference to the cancelable status request promise. This will only be
     * set while the status request is pending. Used by the `cancel` method to
     * abort the status request if it is currently running.
     */
    private statusRequest: CancelableRequest<Response<any>> | null = null;

    /**
     * Multiple file download streams may exist. We store references to them
     * here so that we can destroy them on abort
     */
    private downloadStreams: Set<Request> = new Set()

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

    public async cancel(reason = "Import canceled")
    {
        this.debug("aborting...")
        this._aborted = true

        // Abort wait timeouts (if any)
        this.debug("aborting wait timeouts")
        this.abortController.abort()

        // Abort authorization request (if pending)
        if (this.authRequest) {
            this.debug("aborting authorization request")
            this.authRequest.cancel(reason)
            this.authRequest = null
        }

        // Abort kick-off request (if pending)
        if (this.kickOffRequest) {
            this.debug("aborting kick-off request")
            this.kickOffRequest.cancel(reason)
            this.kickOffRequest = null
        }

        // Abort status request (if pending)
        if (this.statusRequest) {
            this.debug("aborting status request")
            this.statusRequest.cancel(reason)
            this.statusRequest = null
        }

        // Abort downloads (if any)
        this.downloadStreams.forEach(stream => {
            this.debug("aborting download from %s", stream.options.url.href)
            this.downloadStreams.delete(stream)
            stream.destroy()
        })
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

        this.authRequest = request

        const { body } = await this.authRequest

        debugOutgoingAuth("Received access token response from data provider:", body)
        this.debug("Completed authorization request to data provider")

        this.authRequest = null

        return body.access_token || ""
    }

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

        // this._aborted = false

        this.debug("Making export kick-off request")

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
            this.debug("Completed export kick-off request")
            this.kickOffRequest = null
            return res
        })
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

        this.statusRequest = this.fetchExportManifest(contentLocation);
        const { body, statusCode, headers } = await this.statusRequest;
        this.statusRequest = null

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
    fetchExportManifest(location: string): CancelableRequest<Response<BulkData.ExportManifest>>
    {
        if (this._aborted) {
            throw new CustomError(410, "The export has been canceled by the client");
        }

        return this.request<BulkData.ExportManifest>(location, {
            responseType: "json",
            headers: {
                authorization: `Bearer ${ this.accessToken }`
            }
        });
    }

    downloadFile(descriptor: BulkData.ExportManifestFile)
    {
        if (this._aborted) {
            throw new AbortError("The export has been canceled by the client");
        }

        const out = {
            stream: () => {
                const stream = this.request.stream(descriptor.url, {
                    headers: {
                        authorization: `Bearer ${ this.accessToken }`
                    }
                });
                this.downloadStreams.add(stream)
                stream.once("close", () => {
                    this.downloadStreams.delete(stream)
                });
                stream.once("readable", () => {
                    this.debug("Downloading file %s", descriptor.url)
                });
                return stream;
            },
            promise: (destination: Writable) => {
                return new Promise((resolve, reject) => {
                    const source = out.stream();
                    let pipeline: Writable = source.pipe(destination);
                    pipeline.once("finish", resolve);
                    pipeline.once("error", e => reject(new OperationOutcome(e.message, 500)));
                });
            }
        };

        return out
    }
}
