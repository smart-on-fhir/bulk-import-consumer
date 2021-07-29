import { htmlEncode } from "./lib"
import { ProblemSeverity } from "../types";

export class OperationOutcome
{
    /**
     * The issue diagnostics message
     */
    message: string;

    /**
     * @see http://hl7.org/fhir/valueset-issue-type.html
     */
    issueCode: string|number;

    /**
     * issue severity
     */
    severity: ProblemSeverity;

    constructor(message: string, issueCode?: string|number, severity?: ProblemSeverity)
    {
        this.message   = message
        this.issueCode = issueCode || "processing"
        this.severity  = severity  || "error"
    }

    toJSON()
    {
        return {
            "resourceType": "OperationOutcome",
            "text": {
                "status": "generated",
                "div": '<div xmlns="http://www.w3.org/1999/xhtml"><h1>Operation Outcome</h1>' +
                '<table border="0"><tr><td style="font-weight:bold;">ERROR</td><td>[]</td>' +
                '<td><pre>' + htmlEncode(this.message) + '</pre></td></tr></table></div>'
            },
            "issue": [
                {
                    "severity"   : this.severity,
                    "code"       : this.issueCode,
                    "diagnostics": this.message
                }
            ]
        }
    }
}
