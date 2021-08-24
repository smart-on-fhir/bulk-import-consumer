"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const util_1 = __importDefault(require("util"));
const got_1 = require("got");
const OperationOutcome_1 = require("./OperationOutcome");
const CustomError_1 = require("./CustomError");
const lib_1 = require("./lib");
const auth_1 = require("./auth");
const generator_1 = __importDefault(require("./generator"));
const OAuthError_1 = require("./OAuthError");
const config_1 = __importDefault(require("./config"));
const ImportJob_1 = require("./ImportJob");
const path_1 = require("path");
const debug = util_1.default.debuglog("app");
const app = express_1.default();
app.use(cors_1.default({ origin: true, credentials: true }));
app.get("/jwks", (req, res) => res.json({ keys: [config_1.default.publicKey] }));
app.post("/\\$import", express_1.default.json({ type: config_1.default.jsonContentTypes }), lib_1.routeHandler(ImportJob_1.ImportJob.kickOff));
app.get("/job/:id/import-outcome.ndjson", lib_1.routeHandler(ImportJob_1.ImportJob.importOutcome));
app.get("/job/:id", lib_1.routeHandler(ImportJob_1.ImportJob.status));
app.delete("/job/:id", lib_1.routeHandler(ImportJob_1.ImportJob.cancel));
app.post("/auth/token", express_1.default.urlencoded({ extended: false }), lib_1.routeHandler(auth_1.tokenHandler));
app.post("/auth/register", express_1.default.json(), lib_1.routeHandler(auth_1.registrationHandler));
app.get("/generator", generator_1.default);
app.get("/info", (req, res) => {
    const json = [];
    const origin = lib_1.getRequestBaseURL(req);
    json.push({
        label: "Server URL",
        value: origin,
        description: "The server you are using is currently hosted at this URL"
    });
    json.push({
        label: "Import Kick-off URL",
        value: `${origin}/$import`,
        description: "Data Providers can send ping requests to this URL to trigger imports"
    });
    json.push({
        label: "Registration Endpoint",
        value: `${origin}/auth/register`,
        description: "POST requests can be sent to this URL to register new clients dynamically"
    });
    json.push({
        label: "Token Endpoint",
        value: `${origin}/auth/token`,
        description: "Registered clients should send authentication requests to this URL"
    });
    json.push({
        label: "JWKS URL",
        value: `${origin}/jwks`,
        description: "The public key of this server is available at this URL"
    });
    json.push({
        label: "Public Key",
        value: config_1.default.publicKey,
        description: "Use this when you want to register this server as client of a data provider which does not support JWKS URL authentication"
    });
    switch (config_1.default.destination.type) {
        case "dev-null":
            json.push({
                label: "Import File Behavior",
                value: "none",
                description: "Imported files are discarded immediately (this is just a test server)"
            });
            break;
        case "tmp-fs":
            json.push({
                label: "Import File Behavior",
                value: "temporary filesystem storage",
                description: `Imported files are stored at ${path_1.resolve(__dirname, "../jobs")}/{job_id} for ${config_1.default.jobsMaxAge} minutes`
            });
            break;
        case "s3":
            json.push({
                label: "Import File Behavior",
                value: "Amazon S3 Bucket",
                description: `Imported files are uploaded to your ${config_1.default.destination.options.bucketName} bucket`
            });
            break;
    }
    res.json(json);
});
app.use(express_1.default.static("frontend"));
app.use((error, req, res, next) => {
    if (error instanceof got_1.CancelError) {
        debug("Global Error Handler: %s", error.message);
        return res.status(410).end(error.message);
    }
    if (config_1.default.jsonContentTypes.indexOf(req.headers.accept + "") > -1) {
        if (error instanceof got_1.RequestError) {
            return res.status(500).json(new OperationOutcome_1.OperationOutcome(error.message).toJSON());
        }
        if (error instanceof got_1.HTTPError) {
            return res.status(500).json(new OperationOutcome_1.OperationOutcome(error.message).toJSON());
        }
        if (error instanceof OAuthError_1.OAuthError) {
            return res.status(error.status).json(error.toJSON());
        }
        if (error instanceof CustomError_1.CustomError) {
            return res.status(error.status).json(new OperationOutcome_1.OperationOutcome(error.message, error.status, error.severity).toJSON());
        }
        return res.status(500).json(new OperationOutcome_1.OperationOutcome("Internal Server Error", 500, "fatal").toJSON());
    }
    if (error instanceof CustomError_1.CustomError) {
        return res.status(error.status).json(error);
    }
    console.log("Global Error Handler: %o", error);
    res.status(500).end('Internal Server Error');
});
const server = app.listen(config_1.default.port, config_1.default.host, () => {
    let addr = server.address();
    if (addr && typeof addr != "string") {
        const { address, port } = addr;
        addr = `http://${address}:${port}`;
    }
    console.log(`Server listening on ${addr}`);
});
