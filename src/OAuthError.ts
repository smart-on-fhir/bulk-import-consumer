import { format } from "util";
import { JsonObject } from "../types";
import { CustomError } from "./CustomError";

export type OAuthErrorType = (
    /**
     * The request is missing a required parameter, includes an
     * unsupported parameter value (other than grant type),
     * repeats a parameter, includes multiple credentials,
     * utilizes more than one mechanism for authenticating the
     * client, or is otherwise malformed.
     */
    "invalid_request" |

    /**
     * Client authentication failed (e.g., unknown client, no
     * client authentication included, or unsupported
     * authentication method).  The authorization server MAY
     * return an HTTP 401 (Unauthorized) status code to indicate
     * which HTTP authentication schemes are supported.  If the
     * client attempted to authenticate via the "Authorization"
     * request header field, the authorization server MUST
     * respond with an HTTP 401 (Unauthorized) status code and
     * include the "WWW-Authenticate" response header field
     * matching the authentication scheme used by the client.
     */
    "invalid_client" |

    /**
     * The provided authorization grant (e.g., authorization
     * code, resource owner credentials) or refresh token is
     * invalid, expired, revoked, does not match the redirection
     * URI used in the authorization request, or was issued to
     * another client.
     */
    "invalid_grant" |

    /**
     * The authenticated client is not authorized to use this
     * authorization grant type.
     */
    "unauthorized_client" |
    
    /**
     * The authorization grant type is not supported by the
     * authorization server.
     */
    "unsupported_grant_type" |
    
    /**
     * The requested scope is invalid, unknown, malformed, or
     * exceeds the scope granted by the resource owner.
     */
    "invalid_scope"
)

export class OAuthError extends CustomError
{    
    errorType: string;

    constructor(status: number, errorType: OAuthErrorType, message: string, ...args: any[])
    {
        super(status, format(message, ...args))
        this.errorType = errorType
    }

    toJSON(): JsonObject {
        return {
            error: this.errorType,
            error_description: this.message
        }
    }
}
