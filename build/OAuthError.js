"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthError = void 0;
const util_1 = require("util");
const CustomError_1 = require("./CustomError");
class OAuthError extends CustomError_1.CustomError {
    constructor(status, errorType, message, ...args) {
        super(status, util_1.format(message, ...args));
        this.errorType = errorType;
    }
    toJSON() {
        return {
            error: this.errorType,
            error_description: this.message
        };
    }
}
exports.OAuthError = OAuthError;
