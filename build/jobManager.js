"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.start = void 0;
const util_1 = __importDefault(require("util"));
const path_1 = require("path");
const promises_1 = require("fs/promises");
const config_1 = __importDefault(require("./config"));
const lib_1 = require("./lib");
const debug = util_1.default.debuglog("app");
let running = false;
async function getJobIds() {
    const entries = await promises_1.readdir(config_1.default.jobsPath, { withFileTypes: true });
    return entries.filter(entry => {
        return entry.isDirectory() && entry.name.match(/^[a-fA-F0-9]+$/);
    }).map(entry => entry.name);
}
async function cleanUp() {
    const now = Date.now();
    const ids = await getJobIds();
    const { jobsMaxAbsoluteAge, jobsMaxAge } = config_1.default;
    for (const id of ids) {
        const filePath = path_1.join(config_1.default.jobsPath, id, "state.json");
        if (lib_1.isFile(filePath)) {
            const { completedAt, createdAt } = await lib_1.readJSON(filePath);
            if (completedAt) {
                if (now - completedAt > jobsMaxAge * 60000) {
                    debug("Deleting state for expired job #%s", id);
                    await promises_1.rm(path_1.join(config_1.default.jobsPath, id), { recursive: true });
                }
            }
            else if (now - createdAt > jobsMaxAbsoluteAge * 60000) {
                debug("Deleting state for zombie job #%s", id);
                await promises_1.rm(path_1.join(config_1.default.jobsPath, id), { recursive: true });
            }
        }
    }
    setTimeout(cleanUp, 60000).unref();
}
function start() {
    if (!running) {
        running = true;
        cleanUp();
    }
}
exports.start = start;
