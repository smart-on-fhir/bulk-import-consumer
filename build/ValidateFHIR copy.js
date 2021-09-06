"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stream_1 = require("stream");
/**
 * Passes FHIR resources through if they have a "resourceType" and "id"
 * properties. Throws otherwise.
 */
class ValidateFHIR extends stream_1.Transform {
    constructor() {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });
        this._resourceNumber = 1;
    }
    _transform(resource, encoding, next) {
        const resourceType = resource.resourceType;
        if (!resourceType) {
            return next(new Error(`No resourceType found for resource number ${this._resourceNumber}.`));
        }
        if (!resource.id && resourceType !== "Bundle") {
            return next(new Error(`No "id" found for resource number ${this._resourceNumber}.`));
        }
        this.push(resource);
        this._resourceNumber++;
        next();
    }
}
exports.default = ValidateFHIR;
