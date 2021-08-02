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
const lib_1 = require("./lib");
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
    constructor(state) {
        this.state = state;
    }
    // Begin Route Handlers ----------------------------------------------------
    static async kickOff(req, res, next) {
        await auth_1.authorizeIncomingRequest(req);
        validateKickOffHeaders(req);
        validateKickOffBody(req);
        const { exportType, exportUrl, exportParams } = getImportPingParameters(req.body);
        const job = await ImportJob.create();
        job.state.set("exportType", exportType);
        await job.state.save();
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
        res.set("content-location", `${lib_1.getRequestBaseURL(req)}/job/${job.state.id}`);
        res.status(202);
        return res.end();
    }
    static async importOutcome(req, res) {
        const job = await ImportJob.byId(req.params.id);
        const outcomes = job.state.get("outcome");
        res.set("content-type", "application/fhir+json");
        for (const outcome of outcomes) {
            res.write(JSON.stringify(outcome) + "\n");
        }
        res.end();
    }
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
        res.set({
            "Cache-Control": "no-store",
            "Pragma": "no-cache"
        });
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
                job.state.set("status", "Importing completed");
                await job.state.save();
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
    static async cancel(req, res) {
        const job = await ImportJob.byId(req.params.id);
        console.log(`Deleting job "${req.params.id}"`);
        await job.cancel();
        res.status(202).json(new OperationOutcome_1.OperationOutcome("Import job was removed", "processing", "information"));
    }
    // End Route Handlers ------------------------------------------------------
    static async byId(id) {
        // console.log(`byId("${id}")`)
        const model = await JsonModel_1.JsonModel.byId(id);
        if (model) {
            return new ImportJob(model);
        }
        throw new CustomError_1.CustomError(404, `Cannot find import job with id "${id}"`);
    }
    static async create(state) {
        const model = await JsonModel_1.JsonModel.create(state);
        model.set("createdAt", Date.now());
        model.set("exportProgress", 0);
        model.set("importProgress", 0);
        model.set("outcome", []);
        await model.save();
        return new ImportJob(model);
    }
    toJSON() {
        return this.state;
    }
    async cancel() {
        return promises_1.rm(path_1.join(config_1.default.jobsPath, this.state.id), {
            recursive: true,
            maxRetries: 1,
            force: true
        });
    }
    // private methods ---------------------------------------------------------
    getBulkDataClient() {
        if (!this.client) {
            this.client = new BulkDataClient_1.BulkDataClient({
                clientId: config_1.default.exportClient.clientId,
                tokenUrl: config_1.default.exportClient.tokenURL,
                privateKey: config_1.default.privateKey,
                accessTokenLifetime: 3600,
                verbose: false
            });
        }
        return this.client;
    }
    async startDynamicImport(kickOffUrl, params = {}) {
        this.state.set("exportUrl", kickOffUrl);
        this.state.set("exportParams", params);
        await this.state.save();
        const bdClient = this.getBulkDataClient();
        const kickOffResponse = await bdClient.kickOff(kickOffUrl, params);
        const contentLocation = kickOffResponse.headers["content-location"];
        this.state.set("exportStatusLocation", contentLocation);
        this.state.set("status", "Waiting for export files to be generated");
        await this.state.save();
        setImmediate(() => this.waitForExport(kickOffResponse, bdClient));
    }
    async startStaticImport(manifestUrl) {
        console.log(`Starting static import from ${manifestUrl}`);
        const bdClient = this.getBulkDataClient();
        const { body } = await bdClient.fetchExportManifest(manifestUrl);
        this.state.set("exportProgress", 100);
        this.state.set("manifest", body);
        await this.state.save();
        setImmediate(() => this.waitForImport(bdClient));
    }
    async waitForExport(kickOffResponse, client) {
        const manifest = await client.waitForExport(kickOffResponse, async (pct) => {
            this.state.set("exportProgress", pct);
            await this.state.save();
        });
        this.state.set("manifest", manifest);
        await this.state.save();
        return this.waitForImport(client);
    }
    async waitForImport(client) {
        this.state.set("importProgress", 0);
        await this.state.save();
        const manifest = this.state.get("manifest");
        const outcomes = this.state.get("outcome");
        const len = manifest.output?.length;
        let done = 0;
        const now = new Date();
        const folder = [
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
        ].join("-") + "T" + [
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds()
        ].join(":") + "Z";
        for (const file of manifest.output) {
            this.state.set("status", `Importing file ${path_1.basename(file.url)}`);
            await this.state.save();
            try {
                if (config_1.default.destination.type == "dev-null") {
                    await client.downloadFile(file).promise(new DevNull_1.DevNull());
                }
                else if (config_1.default.destination.type == "tmp-fs") {
                    await client.downloadFile(file).promise(fs_1.createWriteStream(path_1.join(config_1.default.jobsPath, this.state.id, path_1.basename(file.url))));
                }
                else if (config_1.default.destination.type == "s3") {
                    const aws = (await Promise.resolve().then(() => __importStar(require("./aws")))).default;
                    const stream = client.downloadFile(file).stream();
                    const upload = new aws.S3.ManagedUpload({
                        params: {
                            Bucket: String(config_1.default.destination.options.bucketName),
                            Key: folder + "/" + path_1.basename(file.url),
                            Body: stream,
                            ContentType: "application/ndjson"
                        }
                    });
                    await upload.promise();
                }
                outcomes.push(new OperationOutcome_1.OperationOutcome(`File from ${file.url} imported successfully`, 200, "information"));
            }
            catch (ex) {
                console.log(`Error handling file ${file.url}`);
                console.error(ex);
                outcomes.push(ex);
            }
            this.state.set("importProgress", Math.round((++done / len) * 100));
            await this.state.save();
        }
        return this;
    }
}
exports.ImportJob = ImportJob;
// -----------------------------------------------------------------------------
async function cleanUp() {
    const ids = await lib_1.getJobIds();
    for (const id of ids) {
        const filePath = path_1.join(config_1.default.jobsPath, id, "state.json");
        if (lib_1.isFile(filePath)) {
            const json = await lib_1.readJSON(filePath);
            if (Date.now() - json.createdAt > config_1.default.jobsMaxAge * 60000) {
                await promises_1.rm(path_1.join(config_1.default.jobsPath, id), { recursive: true });
            }
        }
    }
    setTimeout(cleanUp, 60000).unref();
}
cleanUp();
