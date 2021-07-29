"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevNull = void 0;
const stream_1 = require("stream");
class DevNull extends stream_1.Writable {
    constructor() {
        super({ objectMode: true });
    }
    _write(chunk, encoding, callback) {
        callback();
    }
}
exports.DevNull = DevNull;
