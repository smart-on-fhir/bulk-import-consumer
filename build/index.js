"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const got_1 = require("got");
const OperationOutcome_1 = require("./OperationOutcome");
const CustomError_1 = require("./CustomError");
const lib_1 = require("./lib");
const auth_1 = require("./auth");
const generator_1 = __importDefault(require("./generator"));
const OAuthError_1 = require("./OAuthError");
const config_1 = __importDefault(require("./config"));
const ImportJob_1 = require("./ImportJob");
const app = express_1.default();
app.use(cors_1.default({ origin: true, credentials: true }));
app.post("/\\$import", express_1.default.json({ type: config_1.default.jsonContentTypes }), lib_1.routeHandler(ImportJob_1.ImportJob.kickOff));
app.get("/job/:id/import-outcome.ndjson", lib_1.routeHandler(ImportJob_1.ImportJob.importOutcome));
app.get("/job/:id", lib_1.routeHandler(ImportJob_1.ImportJob.status));
app.delete("/job/:id", lib_1.routeHandler(ImportJob_1.ImportJob.cancel));
app.post("/auth/token", express_1.default.urlencoded({ extended: false }), lib_1.routeHandler(auth_1.tokenHandler));
app.post("/auth/register", express_1.default.json(), lib_1.routeHandler(auth_1.registrationHandler));
app.get("/generator", generator_1.default);
app.use(express_1.default.static("frontend"));
app.use((error, req, res, next) => {
    console.error(error);
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
            res.status(error.status).json(new OperationOutcome_1.OperationOutcome(error.message, error.status, error.severity).toJSON());
        }
        else {
            res.status(500).json(new OperationOutcome_1.OperationOutcome("Internal Server Error", 500, "fatal").toJSON());
        }
    }
    else {
        if (error instanceof CustomError_1.CustomError) {
            res.status(error.status).json(error);
        }
        else {
            res.status(500).end('Internal Server Error');
        }
    }
});
const server = app.listen(config_1.default.port, config_1.default.host, () => {
    let addr = server.address();
    if (addr && typeof addr != "string") {
        const { address, port } = addr;
        addr = `http://${address}:${port}`;
    }
    console.log(`Server listening on ${addr}`);
});
