import util                 from "util"
import { join }             from "path"
import { rm, readdir }      from "fs/promises"
import config               from "./config"
import { isFile, readJSON } from "./lib"
import { ImportServer }     from "../types"


const debug = util.debuglog("app")

let running = false;

async function getJobIds() {
    const entries = await readdir(config.jobsPath, { withFileTypes: true });
    return entries.filter(entry => {
        return entry.isDirectory() && entry.name.match(/^[a-fA-F0-9]+$/);
    }).map(entry => entry.name);
}

async function cleanUp() {
    const now = Date.now()
    const ids = await getJobIds()
    const { jobsMaxAbsoluteAge, jobsMaxAge } = config
    for (const id of ids) {
        const filePath = join(config.jobsPath, id, "state.json")
        if (isFile(filePath)) {
            const { completedAt, createdAt } = await readJSON<ImportServer.ImportJobState>(filePath)

            if (completedAt) {
                if (now - completedAt > jobsMaxAge * 60000) {
                    debug("Deleting state for expired job #%s", id)
                    await rm(join(config.jobsPath, id), { recursive: true })
                }
            }
            else if (now - createdAt > jobsMaxAbsoluteAge * 60000) {
                debug("Deleting state for zombie job #%s", id)
                await rm(join(config.jobsPath, id), { recursive: true })
            }
        }
    }
    setTimeout(cleanUp, 60000).unref();
}

export function start() {
    if (!running) {
        running = true;
        cleanUp()
    }
}
