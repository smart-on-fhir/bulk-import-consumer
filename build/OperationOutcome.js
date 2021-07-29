"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationOutcome = void 0;
const lib_1 = require("./lib");
class OperationOutcome {
    constructor(message, issueCode, severity) {
        this.message = message;
        this.issueCode = issueCode || "processing";
        this.severity = severity || "error";
    }
    toJSON() {
        return {
            "resourceType": "OperationOutcome",
            "text": {
                "status": "generated",
                "div": '<div xmlns="http://www.w3.org/1999/xhtml"><h1>Operation Outcome</h1>' +
                    '<table border="0"><tr><td style="font-weight:bold;">ERROR</td><td>[]</td>' +
                    '<td><pre>' + lib_1.htmlEncode(this.message) + '</pre></td></tr></table></div>'
            },
            "issue": [
                {
                    "severity": this.severity,
                    "code": this.issueCode,
                    "diagnostics": this.message
                }
            ]
        };
    }
}
exports.OperationOutcome = OperationOutcome;
