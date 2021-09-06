"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFileName = void 0;
// HAPI uses `{baseUrl}/Binary/{ID}` (where ID is a random integer) for file
// download locations. We need to rename files to match the following template:
// `{counter}.{ResourceType}.ndjson`
function getFileName(resourceType, counter = 1) {
    return `${counter}.${resourceType}.ndjson`;
}
exports.getFileName = getFileName;
// DocumentReference resources may contain references to external documents.
// We have to fetch those and put them inline as base64
