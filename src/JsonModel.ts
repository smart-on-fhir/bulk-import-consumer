import crypto               from "crypto"
import fs                   from "fs/promises"
import { join }             from "path"
import { existsSync }       from "fs"
import { isFile, readJSON } from "./lib"
import config               from "./config"


export class JsonModel<T=Record<string, any>>
{
    private state: T;

    public readonly id: string;

    private path: string;

    public static async create<T=Record<string, any>>(state?: T): Promise<JsonModel<T>>
    {
        const id = crypto.randomBytes(config.jobsIdLength).toString("hex")
        await fs.mkdir(join(config.jobsPath, id))
        const instance = new JsonModel<T>(id, state)
        await instance.save()
        return instance
    }

    public static async byId<T=Record<string, any>>(id: string): Promise<JsonModel<T> | null>
    {
        const filePath = join(config.jobsPath, id, "state.json")
        if (isFile(filePath)) {
            const state: T = await readJSON(filePath)
            return new JsonModel<T>(id, state)
        }
        return null
    }

    private constructor(id: string, state: T)
    {
        this.id = id
        this.path = join(config.jobsPath, id, "state.json")
        this.state = { ...state }
    }

    public toJSON(): T
    {
        return this.state
    }

    public get(key: keyof T): any
    {
        return this.state[key]
    }

    public set(key: keyof T, value: any): void
    {
        this.state[key] = value
    }

    public unset(key: keyof T): void
    {
        delete this.state[key]
    }

    public async save(): Promise<void>
    {
        if (existsSync(join(config.jobsPath, this.id))) {
            await fs.writeFile(this.path, JSON.stringify(this.toJSON(), null, 4))
        }
    }

    public delete(): Promise<void>
    {
        return fs.unlink(this.path)
    }
}
