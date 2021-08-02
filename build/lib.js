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
exports.getJobIds = exports.getRequestBaseURL = exports.readJSON = exports.deleteFileIfExists = exports.isFile = exports.wait = exports.routeHandler = exports.getParameter = exports.assert = exports.asArray = exports.htmlEncode = void 0;
const fs_1 = require("fs");
const promises_1 = require("fs/promises");
const util = __importStar(require("util"));
const CustomError_1 = require("./CustomError");
const config_1 = __importDefault(require("./config"));
const RE_GT = />/g;
const RE_LT = /</g;
const RE_AMP = /&/g;
const RE_QUOT = /"/g;
function htmlEncode(input) {
    return String(input)
        .trim()
        .replace(RE_AMP, "&amp;")
        .replace(RE_LT, "&lt;")
        .replace(RE_GT, "&gt;")
        .replace(RE_QUOT, "&quot;");
}
exports.htmlEncode = htmlEncode;
function asArray(x) {
    return Array.isArray(x) ? x : [x];
}
exports.asArray = asArray;
function assert(condition, message, ...rest) {
    if (!(condition)) {
        if (message && typeof message === "object") {
            throw new CustomError_1.CustomError(message.code, util.format(message.message, ...rest), message.severity);
        }
        throw new CustomError_1.CustomError(500, util.format(message, ...rest));
    }
}
exports.assert = assert;
/**
 * @param parameters A parameters resource
 * @param name The name of the parameter to look up
 * @param valueX White list of valueX names to use
 * @returns The value (or array of values) found in the valueX attribute or undefined
 */
function getParameter(parameters, name, valueX) {
    const result = parameters.parameter.filter(p => p.name === name).map(param => {
        // Get the value from exact valueX property
        if (typeof valueX == "string") {
            return param[valueX];
        }
        // Get the value from any of the white-listed valueX properties
        if (Array.isArray(valueX)) {
            const key = valueX.find(x => x in param);
            return key ? param[key] : undefined;
        }
        // Get the first valueX property we find
        for (let key in param) {
            if (key.startsWith("value")) {
                return param[key];
            }
        }
    }).filter(x => x !== undefined);
    return (result.length > 1 ? result : result[0]);
}
exports.getParameter = getParameter;
/**
 * Creates and returns a route-wrapper function that allows for using an async
 * route handlers without try/catch.
 */
function routeHandler(fn) {
    return (req, res, next) => {
        if (util.types.isAsyncFunction(fn)) {
            return Promise.resolve().then(() => fn(req, res, next)).catch(next);
        }
        try {
            fn(req, res, next);
        }
        catch (ex) {
            next(ex);
        }
    };
}
exports.routeHandler = routeHandler;
/**
 * Simple utility for waiting. Returns a promise that will resolve after @ms
 * milliseconds.
 */
function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("Waiting aborted"));
            }, { once: true });
        }
    });
}
exports.wait = wait;
function isFile(path) {
    try {
        const stat = fs_1.statSync(path);
        return stat.isFile();
    }
    catch {
        return false;
    }
}
exports.isFile = isFile;
function deleteFileIfExists(path) {
    try {
        if (isFile(path)) {
            fs_1.unlinkSync(path);
        }
    }
    catch (ex) {
        console.error(ex);
        return false;
    }
    return true;
}
exports.deleteFileIfExists = deleteFileIfExists;
/**
 * Read a file and parse it as JSON.
 */
async function readJSON(path) {
    return promises_1.readFile(path).then(json => parseJSON(json));
}
exports.readJSON = readJSON;
/**
* Parses the given json string into a JSON object. Internally it uses the
* JSON.parse() method but adds three things to it:
* 1. Returns a promise
* 2. Ensures async result
* 3. Catches errors and rejects the promise
* @todo Investigate if we can drop the try/catch block and rely on the built-in
*       error catching.
*/
async function parseJSON(json) {
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            let out;
            try {
                out = JSON.parse(String(json));
            }
            catch (error) {
                console.error(error);
                console.log(json);
                return reject(error);
            }
            resolve(out);
        });
    });
}
/**
 * Given a request object, returns its base URL
 */
function getRequestBaseURL(req) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    return protocol + "://" + host;
}
exports.getRequestBaseURL = getRequestBaseURL;
async function getJobIds() {
    const entries = await promises_1.readdir(config_1.default.jobsPath, { withFileTypes: true });
    return entries.filter(entry => {
        return entry.isDirectory() && entry.name.match(/^[a-fA-F0-9]+$/);
    }).map(entry => entry.name);
}
exports.getJobIds = getJobIds;
