"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonModel = void 0;
const crypto_1 = __importDefault(require("crypto"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = require("path");
const fs_1 = require("fs");
const lib_1 = require("./lib");
const config_1 = __importDefault(require("./config"));
class JsonModel {
    constructor(id, state) {
        this.id = id;
        this.path = path_1.join(config_1.default.jobsPath, id, "state.json");
        this.state = { ...state };
    }
    static async create(state) {
        const id = crypto_1.default.randomBytes(config_1.default.jobsIdLength).toString("hex");
        await promises_1.default.mkdir(path_1.join(config_1.default.jobsPath, id));
        const instance = new JsonModel(id, state);
        await instance.save();
        return instance;
    }
    static async byId(id) {
        const filePath = path_1.join(config_1.default.jobsPath, id, "state.json");
        if (lib_1.isFile(filePath)) {
            const state = await lib_1.readJSON(filePath);
            return new JsonModel(id, state);
        }
        return null;
    }
    toJSON() {
        return this.state;
    }
    get(key) {
        return this.state[key];
    }
    set(key, value) {
        this.state[key] = value;
    }
    unset(key) {
        delete this.state[key];
    }
    async save(props) {
        if (fs_1.existsSync(path_1.join(config_1.default.jobsPath, this.id))) {
            if (props) {
                for (let key in props) {
                    this.set(key, props[key]);
                }
            }
            await lib_1.writeJSON(this.path, this.toJSON());
        }
    }
    delete() {
        return promises_1.default.unlink(this.path);
    }
}
exports.JsonModel = JsonModel;
