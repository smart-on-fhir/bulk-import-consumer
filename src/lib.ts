import { NextFunction, RequestHandler, Request, Response } from "express";
import { Parameters, ParametersParameter } from "fhir/r4";
import { statSync, unlinkSync } from "fs";
import { readFile, readdir, writeFile } from "fs/promises";
import lockfile from "lockfile"
import * as util from "util"
import { CustomError } from "./CustomError"
import { ProblemSeverity, JsonValue, JsonObject, JsonPrimitive } from "../types";
import config from "./config"
import { basename } from "path/posix";

const debug = util.debuglog("app")

export class AbortError extends Error {
    constructor(message = "Operation aborted") {
        super(message)
    }
}


const RE_GT   = />/g;
const RE_LT   = /</g;
const RE_AMP  = /&/g;
const RE_QUOT = /"/g;

export function htmlEncode(input: string)
{
    return String(input)
        .trim()
        .replace(RE_AMP, "&amp;")
        .replace(RE_LT, "&lt;")
        .replace(RE_GT, "&gt;")
        .replace(RE_QUOT, "&quot;");
}

export function asArray(x: any): any[] {
    return Array.isArray(x) ? x : [x]
}

export function truncateUrl(url: string) {
    const _url = new URL(url)
    if (_url.pathname != "/") {
        _url.pathname = ".../" + basename(_url.pathname)
    }
    return _url.href
}

export function assert(
    condition: any,
    message: string | { code: number, message: string, severity?: ProblemSeverity },
    ...rest: any[]
): asserts condition
{
    if (!(condition)) {
        if (message && typeof message === "object") {
            throw new CustomError(message.code, util.format(message.message, ...rest), message.severity);
        }
        throw new CustomError(500, util.format(message, ...rest));
    }
}

/**
 * @param parameters A parameters resource
 * @param name The name of the parameter to look up
 * @param valueX White list of valueX names to use
 * @returns The value (or array of values) found in the valueX attribute or undefined
 */
export function getParameter<T=any>(parameters: Parameters, name: string, valueX?: string | string[])
{
    const result = parameters.parameter.filter(p => p.name === name).map(param => {
    
        // Get the value from exact valueX property
        if (typeof valueX == "string") {
            return param[valueX as keyof ParametersParameter]
        }

        // Get the value from any of the white-listed valueX properties
        if (Array.isArray(valueX)) {
            const key = valueX.find(x => x in param)
            return key ? param[key as keyof ParametersParameter] : undefined
        }

        // Get the first valueX property we find
        for (let key in param) {
            if (key.startsWith("value")) {
                return param[key as keyof ParametersParameter]
            }
        }
    }).filter(x => x !== undefined);

    return (result.length > 1 ? result : result[0]) as T
}

/**
 * Creates and returns a route-wrapper function that allows for using an async
 * route handlers without try/catch.
 */
export function routeHandler(fn: RequestHandler): RequestHandler
{
    return (req: Request, res: Response, next: NextFunction) => {
        if (util.types.isAsyncFunction(fn)) {
            return Promise.resolve().then(() => fn(req, res, next)).catch(next);
        }
        try {
            fn(req, res, next);
        } catch (ex) {
            next(ex)
        }
    };
}

/**
 * Simple utility for waiting. Returns a promise that will resolve after @ms
 * milliseconds.
 */
export function wait(ms: number, signal?: AbortSignal)
{
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (signal) {
                signal.removeEventListener("abort", abort);
            }
            resolve(true)
        }, ms);

        function abort() {
            if (timer) {
                debug("Canceling wait timeout...")
                clearTimeout(timer);
            }
            reject(new AbortError("Waiting aborted"))
        }

        if (signal) {
            signal.addEventListener("abort", abort);
        }
    });
}

export function isFile(path: string)
{
    try {
        const stat = statSync(path);
        return stat.isFile();
    } catch {
        return false;
    }
}

export function deleteFileIfExists(path: string)
{
    try {
        if (isFile(path)) {
            unlinkSync(path);
        }
    } catch (ex) {
        console.error(ex);
        return false;
    }
    return true;
}

/**
 * Read a file and parse it as JSON.
 */
export async function readJSON<T=JsonValue>(path: string, retry=10): Promise<T>
{
    return new Promise((resolve, reject) => {
        // debug(`Acquiring lock ${path}.lock`)
        lockfile.lock(`${path}.lock`, { retries: 10, retryWait: 50 }, e => {
            if (e) {
                debug(`Acquiring lock ${path}.lock failed: %s`, e)
                return reject(e)
            }
            return readFile(path, "utf8").then(json => {
                // debug(`Releasing lock ${path}.lock`)
                lockfile.unlock(`${path}.lock`, err => {
                    if (err) {
                        debug(`Releasing lock ${path}.lock failed: %s`, err)
                        return reject(err)
                    }
                })
                return parseJSON<T>(json).then(json => resolve(json))
            });
        })
    })
}

export async function writeJSON(path: string, data: any) {
    return new Promise((resolve, reject) => {
        // debug(`Acquiring lock ${path}.lock`)
        lockfile.lock(`${path}.lock`, { retries: 10, retryWait: 50 }, e => {
            if (e) {
                debug(`Acquiring lock ${path}.lock failed: %s`, e)
                return reject(e)
            }
            return writeFile(path, JSON.stringify(data, null, 4)).then(json => {
                // debug(`Releasing lock ${path}.lock`)
                lockfile.unlock(`${path}.lock`, err => {
                    if (err) {
                        debug(`Releasing lock ${path}.lock failed: %s`, err)
                        return reject(err)
                    }
                    resolve(data)
                })
            });
        })
    })
}

/**
 * Parses the given json string into a JSON object. Internally it uses the
 * JSON.parse() method but adds three things to it:
 * 1. Returns a promise
 * 2. Ensures async result
 * 3. Catches errors and rejects the promise
 * @todo Investigate if we can drop the try/catch block and rely on the built-in
 *       error catching.
 */
async function parseJSON<T=JsonValue>(json: any): Promise<T>
{
    return new Promise((resolve, reject) => {
        setImmediate(() => {
            let out;
            try {
                out = JSON.parse(String(json));
            }
            catch (error) {
                console.error(error)
                console.log('JSON INPUT:', json)
                return reject(error);
            }
            resolve(out);
        });
    });
}

/**
 * Given a request object, returns its base URL
 */
export function getRequestBaseURL(req: Request) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    return protocol + "://" + host;
}

export async function getJobIds() {
    const entries = await readdir(config.jobsPath, { withFileTypes: true });
    return entries.filter(entry => {
        return entry.isDirectory() && entry.name.match(/^[a-fA-F0-9]+$/);
    }).map(entry => entry.name);
}

export function template(tpl: string, data: {[key: string]: string}) {
    return tpl.replace(/\{(.+?)\}/g, (match, name) => data[name] || match)
}

