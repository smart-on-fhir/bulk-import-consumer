"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportJob = exports.getImportPingParameters = exports.validateKickOffBody = exports.validateKickOffHeaders = void 0;
const util_1 = __importDefault(require("util"));
const events_1 = __importDefault(require("events"));
const path_1 = require("path");
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const CustomError_1 = require("./CustomError");
const OperationOutcome_1 = require("./OperationOutcome");
const BulkDataClient_1 = require("./BulkDataClient");
const JsonModel_1 = require("./JsonModel");
const config_1 = __importDefault(require("./config"));
const auth_1 = require("./auth");
const DevNull_1 = require("./DevNull");
const ParseNDJSON_1 = __importDefault(require("./ParseNDJSON"));
const StringifyNDJSON_1 = __importDefault(require("./StringifyNDJSON"));
const ValidateFHIR_1 = __importDefault(require("./ValidateFHIR"));
const FHIRTransform_1 = __importDefault(require("./FHIRTransform"));
const lib_1 = require("./lib");
events_1.default.defaultMaxListeners = 30;
const debug = util_1.default.debuglog("app");
function validateKickOffHeaders(req) {
    const { 
    /**
     * Specifies the format of the optional OperationOutcome resource
     * response to the kick-off request. The client MAY set this header to
     * application/fhir+json.
     */
    accept = "application/fhir+json", 
    /**
     * Specifies whether the response is immediate or asynchronous. The
     * client MAY set this header to respond-async
     * @see https://tools.ietf.org/html/rfc7240.
     */
    prefer = "respond-async" } = req.headers;
    // We can only handle accept: "application/fhir+json"
    lib_1.assert(accept === "application/fhir+json", {
        code: 400,
        message: 'Only "application/fhir+json" accept header is supported (received: %s)'
    }, accept);
    // We can only handle prefer: "respond-async"
    lib_1.assert(prefer === "respond-async", {
        code: 400,
        message: 'Only "respond-async" prefer header is supported (received: %s)'
    }, prefer);
}
exports.validateKickOffHeaders = validateKickOffHeaders;
function validateKickOffBody(req) {
    lib_1.assert(req.body.resourceType === "Parameters" && Array.isArray(req.body.parameter), {
        code: 400,
        message: "The POST body should be a Parameters resource"
    });
}
exports.validateKickOffBody = validateKickOffBody;
function getImportPingParameters(body) {
    // -------------------------------------------------------------------------
    // exportUrl (string, required for client to include)
    // The FHIR Parameters resource SHALL include an exportUrl parameter with a
    // string containing the kickoff endpoint URL for a FHIR Bulk Data Export
    // server (if the exportType parameters is dynamic) OR the location of a
    // FHIR Bulk Data Export manifest file (if the export_type is static). The
    // supplied parameters MAY include additional FHIR Bulk Data Export kickoff
    // parameters (such as _type or _since). When these parameters are provided,
    // the Data Consumer SHALL include them in the subsequent export request.
    const exportUrl = lib_1.getParameter(body, "exportUrl", [
        "valueUrl",
        "valueUri",
        "valueString"
    ]);
    lib_1.assert(exportUrl, {
        code: 400,
        message: 'exportUrl parameter is required and must have a "valueUrl", ' +
            '"valueUri" or "valueString" property.'
    });
    lib_1.assert(typeof exportUrl == "string", {
        code: 400,
        message: 'exportUrl parameter must have a string value'
    });
    lib_1.assert(exportUrl.match(/^https?\:\/\/.+/), {
        code: 400,
        message: "The exportUrl parameter value must be an URL"
    });
    // -------------------------------------------------------------------------
    // exportType
    // (code, optional for client to include and if omitted defaults to dynamic)
    // The FHIR Parameters resource MAY include a exportType parameter with a
    // string of static or dynamic.
    // -------------------------------------------------------------------------
    const exportType = String(lib_1.getParameter(body, "exportType", ["valueCode", "valueString"]) || "dynamic");
    // Only values "static" and "dynamic" are supported
    lib_1.assert(exportType == "dynamic" || exportType == "static", {
        code: 400,
        message: "Invalid exportType parameter %s. Must be 'static' and 'dynamic'."
    }, exportType);
    // -------------------------------------------------------------------------
    // The supplied parameters MAY include additional FHIR Bulk Data Export
    // kickoff parameters (such as _type or _since). When these parameters are
    // provided, the Data Consumer SHALL include them in the subsequent export
    // request.
    // -------------------------------------------------------------------------
    const exportParams = {
        _type: lib_1.getParameter(body, "_type"),
        _since: lib_1.getParameter(body, "_since"),
        _outputFormat: lib_1.getParameter(body, "_outputFormat"),
        _elements: lib_1.getParameter(body, "_elements"),
        _typeFilter: lib_1.getParameter(body, "_typeFilter"),
        includeAssociatedData: lib_1.getParameter(body, "includeAssociatedData"),
        patient: lib_1.getParameter(body, "patient"),
    };
    return {
        exportUrl,
        exportType: exportType,
        exportParams
    };
}
exports.getImportPingParameters = getImportPingParameters;
class ImportJob {
    /**
     * Note that the constructor is private and is only used internally.
     * Static methods like `create` and `byId` should be used to get an instance.
     * @param state The associated state model
     */
    constructor(state) {
        this.state = state;
        // this.abortController = new AbortController()
    }
    /**
     * Start an import
     * - Validates input headers and parameters body
     * - Creates new ImportJob
     * - Starts static or dynamic import depending on the parameters
     * - Replies with 202 and content-location header
     * @route POST /$import
     */
    static async kickOff(req, res, next) {
        const client = await auth_1.authorizeIncomingRequest(req);
        validateKickOffHeaders(req);
        validateKickOffBody(req);
        const { exportType, exportUrl, exportParams } = getImportPingParameters(req.body);
        const job = await ImportJob.create();
        await job.state.save({ client, exportType });
        let finished = false;
        res.once("finish", () => finished = true);
        res.once("close", async () => {
            if (!finished) {
                job.cancel();
            }
        });
        // If the exportType is static, the Data Consumer will issue a GET
        // request to the exportUrl to retrieve a Bulk Data Manifest file with
        // the location of the Bulk Data files. In this abbreviated export flow,
        // the Data Provider SHALL respond to the GET request with the Complete
        // Status response described in the Bulk Data Export IG.
        if (exportType === "static") {
            await job.startStaticImport(exportUrl);
        }
        // If the exportType is dynamic the Data Consumer will issue a POST
        // request to the exportUrl to obtain a dataset from the Data Provider,
        // following the Bulk Data Export flow described in the Bulk Data Export IG.
        else {
            await job.startDynamicImport(exportUrl, exportParams);
        }
        // if not canceled due to aborting kick-off request
        if (job.state) {
            res.set("content-location", `${lib_1.getRequestBaseURL(req)}/job/${job.state.id}`);
        }
        res.status(202);
        return res.end();
    }
    /**
     * Get job outcomes as NDJSON
     * @throws {CustomError} 404 if job is not found
     * @route GET /job/:id/import-outcome.ndjson
     */
    static async importOutcome(req, res) {
        const job = await ImportJob.byId(req.params.id);
        const outcomes = job.state.get("outcome");
        res.set("content-type", "application/fhir+json");
        for (const outcome of outcomes) {
            res.write(JSON.stringify(outcome) + "\n");
        }
        res.end();
    }
    /**
     * Check the status of import job
     * - If there is no such job throws 404 error
     * - If the job is in progress replies with 202 and progress info headers
     * - If the job is complete replies with 200 and import manifest JSON
     * - Replies with json OperationOutcome in case of error
     * @throws {CustomError} 404 if job is not found
     * @route GET /job/:id
     */
    static async status(req, res) {
        const job = await ImportJob.byId(req.params.id);
        const exportType = job.state.get("exportType");
        const importProgress = job.state.get("importProgress");
        const status = job.state.get("status");
        let progress = importProgress;
        if (exportType == "dynamic") {
            const exportProgress = job.state.get("exportProgress");
            progress = (exportProgress + importProgress) / 2;
        }
        res.set({ "Cache-Control": "no-store", "Pragma": "no-cache" });
        // Response - In-Progress Status ---------------------------------------
        // HTTP Status Code of 202 Accepted
        // Optionally, the Data Consumer MAY return an X-Progress header
        if (progress <= 100 && status !== "Importing completed") {
            res.status(202);
            res.set({
                "x-progress": progress,
                "x-status": status
            });
            // NOTE: To properly render a progress bar on the client side, we
            // have to also reply once with a progress value of 100%. On the
            // next call we will proceed to the success response.
            if (progress === 100) {
                await job.state.save({
                    status: "Importing completed",
                    completedAt: Date.now()
                });
                res.set("retry-after", "1");
            }
            return res.end();
        }
        // Response - Error Status ---------------------------------------------
        // In the case of a polling failure that does not indicate failure of
        // the import job, a Data Consumer SHOULD use a transient code from the
        // IssueType valueset when populating the OperationOutcome issue.code to
        // indicate to the Data Provider that it should retry the request at a
        // later time.
        // Note: Even if some of the requested resources cannot successfully be
        // imported, the overall import operation MAY still succeed. In this
        // case, the Response.outcome array of the completion response body
        // SHALL be populated with one or more files in ndjson format containing
        // FHIR OperationOutcome resources to indicate what went wrong (see
        // below). In the case of a partial success, the Data Consumers SHALL
        // use a 200 status code instead of 4XX or 5XX. The choice of when to
        // determine that an import job has failed in its entirety (error status
        // ) vs returning a partial success (complete status) is left up to the
        // implementer.
        // Response - Complete Status ------------------------------------------
        // HTTP status of 200 OK
        // Content-Type header of application/json
        // The server MAY return an Expires header indicating when the files
        // listed will no longer be available for access.
        // A body containing a JSON object providing metadata, and links to the
        // generated bulk data import status files. The files SHALL be
        // accessible to the client at the URLs advertised. These URLs MAY be
        // served by file servers other than a FHIR-specific server.
        const result = {
            // FHIR instant - Indicates the time when the import was initiated.
            transactionTime: new Date(job.state.get("createdAt")).toISOString(),
            // Indicates whether downloading the generated files requires the
            // same authentication scheme as the import operation itself
            // Value SHALL be true if both the file server and the FHIR API
            // server control access using OAuth 2.0 bearer tokens. Value MAY be
            // false for file servers that use access-control schemes other than
            // OAuth 2.0, such as downloads from Amazon S3 bucket URLs or
            // verifiable file servers within an organization's firewall.
            requiresAccessToken: false,
            // Array of one or more ndjson files containing OperationOutcome
            // resources.
            // 
            // Error, warning, and information messages related to the import
            // should be included here. If there are no relevant messages, the
            // server SHOULD return an empty array. Only the OperationOutcome
            // resource type is currently supported, and.
            // 
            // If the request contained invalid or unsupported parameters along
            // with a Prefer: handling=lenient header and the server processed
            // the request, the server SHOULD include an OperationOutcome
            // resource for each of these parameters.
            // 
            // Each file item SHALL contain a url field containing the path to
            // the file.
            // 
            // Each file item MAY optionally contain a count field with the
            // number of resources in the file, represented as a JSON number.
            //
            // Note that field corresponds to the `error` field in the export
            // operation manifest and has been renamed to reflect its use for
            // informational and warning level OperationOutcome messages.
            outcome: []
        };
        const importOutcomes = job.state.get("outcome");
        if (importOutcomes.length) {
            result.outcome.push({
                url: `${lib_1.getRequestBaseURL(req)}/job/${job.state.id}/import-outcome.ndjson`,
                count: importOutcomes.length
            });
        }
        res.json(result);
    }
    /**
     * Cancel and destroy an import job. If the job does not exist (because it
     * never has, or because it has been canceled already) throws a 404 error.
     * @throws {CustomError} 404 if job is not found
     * @route DELETE /job/:id
     */
    static async cancel(req, res) {
        const job = await ImportJob.byId(req.params.id);
        job.debug("Deleting job");
        await job.cancel();
        res.status(202).json(new OperationOutcome_1.OperationOutcome("Import job was removed", "processing", "information"));
    }
    /**
     * Find an ImportJob by ID.
     * @throws {CustomError} 404 if job is not found
     */
    static async byId(id) {
        const model = await JsonModel_1.JsonModel.byId(id);
        if (model) {
            return new ImportJob(model);
        }
        throw new CustomError_1.CustomError(404, `Cannot find import job with id "${id}"`);
    }
    /**
     * Create new ImportJob
     * @param state Initial state
     */
    static async create(state) {
        const model = await JsonModel_1.JsonModel.create({
            ...state,
            createdAt: Date.now(),
            exportProgress: 0,
            importProgress: 0,
            outcome: []
        });
        return new ImportJob(model);
    }
    /**
     * Cancel this job.
     * - If we have a bulk data client and it is currently requesting something,
     *   abort that request
     * - Remove the persisted job state and downloaded files (if any)
     * - Set `this.state` to `null`
     */
    async cancel() {
        // this.state.set("aborted", true)
        // await this.state.save()
        // this.abortController.abort()
        const client = await this.getBulkDataClient();
        await client.cancel();
        this.debug("Deleting state from %s", path_1.join(config_1.default.jobsPath, this.state.id));
        await promises_1.rm(path_1.join(config_1.default.jobsPath, this.state.id), {
            recursive: true,
            maxRetries: 1,
            force: true
        });
        this.state = null;
    }
    /**
     * A debug method bound to this instance so that it will always prefix
     * messages with the class name and the instance ID.
     */
    debug(message, ...rest) {
        debug("ImportJob#%s: " + message, this.state?.id, ...rest);
    }
    /**
     * Get the BulkDataClient instance we use to delegate all data provider
     * requests. Note that that instance has unique ID, so that we can "revive"
     * it. For example, if we are in the status endpoint, a BulkDataClient
     * should should have been created already during the kick-off and we need
     * to find it and return it instead of creating new one.
     */
    async getBulkDataClient() {
        // In case we already have an instance
        // ---------------------------------------------------------------------
        if (this.bulkDataClient) {
            return this.bulkDataClient;
        }
        // In case this is called while we are already in the process of
        // creating an instance
        // ---------------------------------------------------------------------
        if (this.bulkDataClientPromise) {
            this.bulkDataClient = await this.bulkDataClientPromise;
            this.bulkDataClientPromise = null;
            return this.bulkDataClient;
        }
        // In case we are "reviving" this job (because it has been created in 
        // previous request), we need to find the exact BulkDataClient instance
        // that was previously used
        // ---------------------------------------------------------------------
        const id = this.state.get("bulkDataClientInstanceId");
        if (id) {
            this.debug("Getting BulkDataClient instance with id %s", id);
            this.bulkDataClient = BulkDataClient_1.BulkDataClient.getInstance(id);
            return this.bulkDataClient;
        }
        // Create brand new client instance. Be careful here! It takes a while
        // to create an instance and if getBulkDataClient is called again while
        // waiting we might produce two instances
        // ---------------------------------------------------------------------
        this.debug("Getting new BulkDataClient instance");
        const client = this.state.get("client");
        const instance = new BulkDataClient_1.BulkDataClient({
            clientId: client.consumer_client_id,
            providerBaseUrl: client.aud,
            privateKey: config_1.default.privateKey
        });
        this.debug("Saving new bulkDataClientInstanceId %s", instance.id);
        this.bulkDataClientPromise = this.state.save({
            bulkDataClientInstanceId: instance.id
        }).then(() => instance);
        this.bulkDataClient = await this.bulkDataClientPromise;
        this.bulkDataClientPromise = null;
        return this.bulkDataClient;
    }
    /**
     * Note that this method will resolve when the Bulk Data export has been
     * started. Internally, the job will watch the progress of the export but
     * this method will not wait for it.
     */
    async startDynamicImport(kickOffUrl, params = {}) {
        if (this.state) {
            this.debug("Starting dynamic import from %s", kickOffUrl);
            await this.state.save({ exportUrl: kickOffUrl, exportParams: params });
        }
        if (this.state) {
            await this.getBulkDataClient();
            const kickOffResponse = await this.bulkDataClient.kickOff(kickOffUrl, params);
            const contentLocation = kickOffResponse.headers["content-location"] || "";
            if (this.state) {
                await this.state.save({ exportStatusLocation: contentLocation, status: "Waiting for export files to be generated" });
                this.waitForExport(kickOffResponse);
            }
        }
    }
    /**
     * Note that this method will resolve as soon as the manifest is downloaded.
     * Internally, the job start downloading files and watch the progress but
     * this method will not wait for it.
     */
    async startStaticImport(manifestUrl) {
        if (this.state) {
            this.debug("Starting static import from %s", manifestUrl);
            await this.getBulkDataClient();
            const { body } = await this.bulkDataClient.fetchExportManifest(manifestUrl);
            if (this.state) {
                await this.state.save({ exportProgress: 100, manifest: body });
                this.waitForImport();
            }
        }
    }
    /**
     * Waits for the data provider to export all files. Then automatically calls
     * `this.waitForImport()` to download them.
     */
    async waitForExport(kickOffResponse) {
        this.debug("waitForExport");
        try {
            await this.getBulkDataClient();
            const manifest = await this.bulkDataClient.waitForExport(kickOffResponse, async (pct) => {
                if (!this.state) {
                    throw new CustomError_1.CustomError(410, "The export has been canceled by the client");
                }
                else {
                    await this.state.save({ exportProgress: pct });
                }
            });
            if (!manifest.output?.length) {
                this.debug("waitForExport -> manifest: %o", manifest);
                throw new Error("waitForExport -> no files found in the export manifest");
            }
            await this.state.save({ manifest });
            return this.waitForImport();
        }
        catch (ex) {
            this.debug("waitForExport failed. %s", ex.message);
            this.bulkDataClient.destroy();
        }
    }
    /**
     * Downloads all files from the data provider
     */
    async waitForImport() {
        this.debug("waitForImport");
        await this.getBulkDataClient();
        if (this.bulkDataClient.aborted) {
            this.debug("waitForImport -> exiting because the job was canceled");
            return this;
        }
        await this.state.save({ importProgress: 0 });
        const manifest = this.state.get("manifest");
        const outcomes = this.state.get("outcome");
        const files = manifest?.output || [];
        const len = files.length;
        let done = 0;
        const counters = {};
        for (const file of files) {
            if (!this.state) {
                throw new CustomError_1.CustomError(410, "The export has been canceled by the client");
            }
            await this.state.save({ status: `Importing file ${path_1.basename(file.url)}` });
            try {
                counters[file.type] = counters[file.type] ? counters[file.type] + 1 : 1;
                await this.downloadFile(file, counters);
                outcomes.push(new OperationOutcome_1.OperationOutcome(`File from ${file.url} imported successfully`, 200, "information"));
            }
            catch (ex) {
                if (ex instanceof lib_1.AbortError) {
                    console.log(ex.message);
                    return this;
                }
                console.log(`Error handling file ${file.url}`);
                console.error(ex);
                outcomes.push(ex);
            }
            this.state.set("importProgress", Math.round((++done / len) * 100));
            await this.state.save();
        }
        this.bulkDataClient.destroy();
        return this;
    }
    /**
     * Downloads single file, passing it through our validation and
     * transformation pipeline.
     * 1. Files are downloaded as streams
     * 2. Empty ndjson lines are skipped
     * 3. Each line is parsed as JSON (to verify that is is valid JSON)
     * 4. Each line object must have a "resourceType" property (verifies FHIR)
     * 5. If the resources are of type "DocumentReference":
     *    - Attachments referenced by URL are downloaded and put inline
     *    - PDF attachments are converted to text and then to base64
     * 6. Line objects are converted back to JSON strings
     * 7. The pipeline finishes depending on config:
     *    - If config.destination.type is "dev-null" data is discarded
     *    - If config.destination.type is "tmp-fs" data is saved to FS
     *    - If config.destination.type is "s3" data is uploaded to S3 bucket
     * @param file The file descriptor
     * @param counters An object with resourceType as keys and number as values
     */
    downloadFile(file, counters) {
        return new Promise((resolve, reject) => {
            const errors = [];
            const downloadStream = this.bulkDataClient.downloadFileStream(file);
            downloadStream.once("error", e => errors.push("Error downloading file: " + e.stack));
            // Parse and validate NDJSON
            let pipeline = downloadStream.pipe(new ParseNDJSON_1.default());
            // Validate FHIR NDJSON
            pipeline = pipeline.pipe(new ValidateFHIR_1.default());
            // Apply any custom FHIR resource transformations
            pipeline = pipeline.pipe(new FHIRTransform_1.default());
            // Convert back to NDJSON string
            pipeline = pipeline.pipe(new StringifyNDJSON_1.default());
            // Discard the file (do not store it anywhere)
            if (config_1.default.destination.type == "dev-null") {
                pipeline = pipeline.pipe(new DevNull_1.DevNull());
                pipeline.once("finish", resolve);
                pipeline.once("error", e => reject(new OperationOutcome_1.OperationOutcome(e.message + ": " + errors.join(";"), 500)));
                return;
            }
            // const date = new Date(this.state.get("createdAt"))
            const filename = lib_1.template(config_1.default.downloadFileName, {
                jobId: this.state.id,
                fileNumber: counters[file.type],
                resourceType: file.type,
                originalName: path_1.basename(file.url),
                // exportedAt  : [
                //     date.getUTCFullYear(),
                //     date.getUTCMonth(),
                //     date.getUTCDate()
                // ].join("-") + "T" + [
                //     date.getUTCHours(),
                //     date.getUTCMinutes(),
                //     date.getUTCSeconds()
                // ].join(":") + "Z"
            });
            // Save to local FS (temporary)
            if (config_1.default.destination.type == "tmp-fs") {
                this.debug(`Writing data from ${file.url} to ${filename}`);
                const writeStream = fs_1.createWriteStream(path_1.join(config_1.default.jobsPath, this.state.id, filename));
                writeStream.once("error", e => errors.push("Error writing file: " + e.stack));
                pipeline = pipeline.pipe(writeStream);
                pipeline.once("finish", resolve);
                pipeline.once("error", e => reject(new OperationOutcome_1.OperationOutcome(e.message + ": " + errors.join(";"), 500)));
            }
            // Save to S3 bucket
            else if (config_1.default.destination.type == "s3") {
                Promise.resolve().then(() => __importStar(require("./aws"))).then(aws => {
                    this.debug(`Uploading data from ${file.url} to S3: ${config_1.default.destination.options.bucketName}/${filename}`);
                    const stream = this.bulkDataClient.downloadFileStream(file);
                    const upload = new aws.default.S3.ManagedUpload({
                        params: {
                            Bucket: String(config_1.default.destination.options.bucketName),
                            Key: filename,
                            Body: stream,
                            ContentType: "application/ndjson"
                        }
                    });
                    return upload.promise();
                }).then(() => resolve());
            }
            else {
                reject(new Error(`Unknown config.destination.type "${config_1.default.destination.type}"`));
            }
        });
    }
}
exports.ImportJob = ImportJob;
