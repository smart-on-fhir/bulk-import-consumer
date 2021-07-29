import { JsonObject, ProblemSeverity } from "../types";

export class CustomError extends Error
{
    /**
     * The HTTP status code for this message
     */
    status: number;

    severity: ProblemSeverity;

    constructor(status: number, message: string, severity: ProblemSeverity = "error")
    {
        super(message)
        this.status = status
        this.severity = severity
    }

    toJSON(): JsonObject
    {
        return {
            message : this.message,
            status  : this.status,
            severity: this.severity
        }
    }
}