import { NextFunction, Request, Response } from "express"
import got                                 from "got/dist/source"
import { RequestOptions }                  from "http"
import jwt                                 from "jsonwebtoken"
import jose                                from "node-jose"
import config                              from "./config"
import { CustomError }                     from "./CustomError"
import { getRequestBaseURL }               from "./lib"
import { OAuthError }                      from "./OAuthError"
import { ImportServer }                    from "../types"


export function getRequestToken(req: Request): jwt.JwtPayload
{
    // Verify that authorization header is present
    const header = String(req.headers.authorization || "")
    if (!header) {
        throw new CustomError(401, "Authorization is required", "fatal");
    }

    // Verify that the authorization header contains bearer token (not empty)
    const token = header.replace(/^\s*bearer\s+/i, "")
    if (!token) {
        throw new CustomError(403, "Invalid authorization header", "fatal");
    }

    // Decode the token
    try {
        var decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload
    } catch (ex) {
        throw new CustomError(403, "Invalid authorization token: " + ex.message, "fatal");
    }

    return decoded
}


/**
 * When SMART Backend Services Authorization is used to authorize Data Provider
 * to Data Consumer requests (the initial "ping" and subsequent status checks),
 * the Data Provider will need to be pre-registered with the Data Consumer as a
 * client so the Data Consumer can store the Data Provider's public key
 * information (the key itself or the location of a jwks file) and assign an
 * associated client_id for use in the authorization process.
 */
export async function authorizeIncomingRequest(req: Request)
{
    // 1. Get the bearer token from the authorization header
    const token = getRequestToken(req)
    // console.log(token)

    // // 2. Get the clientId from the token
    // try {
    //     var client = jwt.verify(token.sub, config.jwtSecret) as ImportServer.Client
    // } catch (ex) {
    //     throw new OAuthError(400, "invalid_client", "Invalid client_id token. " + ex.message)
    // }

    return token
}

/**
 * When SMART Backend Services Authorization is used to authorize Data Consumer
 * to Data Provider requests (the full or abbreviated Bulk Data Export flow),
 * the Data Consumer will need to be pre-registered with the Data Provider as a
 * client so the Data Provider can store Data Consumer's public key information
 * and assign an associated a client_id for use in the authorization process.
 */
export function authorizeOutgoingRequest(requestOptions: RequestOptions, consumerClientId: string)
{
    return {
        ...requestOptions,
        headers: {
            ...requestOptions.headers,
            authorization: "bearer " + btoa(consumerClientId)
        }
    }
}

export async function registrationHandler(req: Request, res: Response, next: NextFunction)
{
    // Require "application/json" POSTs
    if (!req.is("application/json")) {
        return next(new OAuthError(400, "invalid_request", "The content type must be application/json"))
    }

    let { jwks, jwks_uri } = req.body

    if (!jwks && !jwks_uri) {
        return next(new OAuthError(400, "invalid_request", "Either 'jwks' or 'jwks_uri' parameter is required"))
    }

    // // parse and validate the "iss" parameter
    // let iss = String(req.body.iss || "").trim()
    // assert(iss, errors.registration.missing_param, "iss")
    
    // // parse and validate the "pub_key" parameter
    // let publicKey = String(req.body.pub_key || "").trim()
    // assert(publicKey, errors.registration.missing_param, "pub_key")

    // // parse and validate the "dur" parameter
    // let dur = parseInt(req.body.dur || "15", 10)
    // assert(!isNaN(dur) && isFinite(dur) && dur >= 0, errors.registration.invalid_param, "dur")

    // // Build the result token
    let jwtToken: Partial<ImportServer.Client> = {}

    if (jwks) {
        jwtToken.jwks = jwks
    } else {
        jwtToken.jwks_uri = jwks_uri
    }

    // // Note that if dur is 0 accessTokensExpireIn will not be included
    // if (dur) {
    //     jwtToken.accessTokensExpireIn = dur
    // }

    // // Custom errors (if any)
    // if (req.body.auth_error) {
    //     jwtToken.auth_error = req.body.auth_error
    // }

    const clientId = jwt.sign(jwtToken, config.jwtSecret)

    jwtToken.iss = clientId

    res.set({
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
    });

    res.json({
        client_id: clientId,
        client_id_issued_at: Math.round(Date.now() / 1000),
        token_endpoint: getRequestBaseURL(req) + "/auth/token"
    });
}

interface AuthenticationToken {
    /**
     * The client_id
     */
    sub: string

    aud: string

    iss: string
}

interface AccessTokenResponse {
    token_type  : "bearer"
    scope     ? : string
    client_id   : string
    expires_in  : number
    access_token: string
}

async function getPublicKeys(jwksOrUri: ImportServer.JWKS | string): Promise<ImportServer.JWK[]>
{
    if (typeof jwksOrUri === "string") {
        try {
            var { keys } = await got<ImportServer.JWKS>(jwksOrUri, {
                resolveBodyOnly: true,
                responseType: "json"
            });
        } catch (ex) {
            throw new Error(
                `Failed to get public key(s) from JWKS URL "${jwksOrUri}". ${ex.message}`
            )
        }
        if (!Array.isArray(keys) || !keys.length) {
            throw new Error(
                `Failed to get public key(s) from JWKS URL "${jwksOrUri}"`
            )
        }
        return keys
    }
    return jwksOrUri.keys
}

/**
 * Handles the backend service authorization requests. Parses and validates
 * input params and eventually calls this.finish() with the parsed client
 * details token.
 */
export async function tokenHandler(req: Request, res: Response, next: NextFunction)
{
    const {
        originalUrl,
        body: {
            client_assertion_type,
            client_assertion
        }
    } = req;

    const algorithms: jwt.Algorithm[] = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"];

    const aud = getRequestBaseURL(req) + originalUrl;

    // client_assertion_type is required
    if (!client_assertion_type) {
        return next(new OAuthError(400, "invalid_request", "client_assertion_type parameter is required"))
    }

    // client_assertion_type must have a fixed value
    if (client_assertion_type !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") {
        return next(new OAuthError(400, "invalid_request", "client_assertion_type must be 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'"))
    }

    // client_assertion must be a sent
    if (!client_assertion) {
        return next(new OAuthError(400, "invalid_request", "Missing client_assertion parameter"))
    }

    // client_assertion must be valid JWT
    try {
        var authenticationToken = jwt.decode(client_assertion) as AuthenticationToken;
    } catch (ex) {
        return next(new OAuthError(400, "invalid_request", "Invalid client_assertion. " + ex.message))
    }

    // The client_id must be valid token too
    try {
        var client = jwt.verify(authenticationToken.sub, config.jwtSecret) as ImportServer.Client
    } catch (ex) {
        return next(new OAuthError(400, "invalid_client", "Invalid client_id token. " + ex.message))
    }

    // Now that we have the client, get its public key and verify the auth token
    try {
        const clientPublicKeys = await getPublicKeys(client.jwks_uri || client.jwks);
        await Promise.any(clientPublicKeys.map(key => {
            return jose.JWK.asKey(key, "json")
                .then(jwk => jwk.toPEM())
                .then(pem => jwt.verify(client_assertion, pem, { algorithms }))
        })).catch(() => {
            throw new Error(
                `None of the (${clientPublicKeys.length
                }) public keys could verify the token`
            )
        });
    } catch (ex) {
        return next(new OAuthError(400, "invalid_client", "Invalid client public key(s). " + ex.message))
    }

    // Validate authenticationToken.aud (must equal this url)
    if (aud.replace(/^https?/, "") !== authenticationToken.aud.replace(/^https?/, "")) {
        return next(new OAuthError(400, "invalid_request", "Invalid 'aud'"))
    }

    if (authenticationToken.iss !== authenticationToken.sub) {
        return next(new OAuthError(400, "invalid_request", "Invalid 'iss' or 'sub' token claim"))
    }

    const expiresIn = config.accessTokensExpireIn * 60;

    var token: Partial<AccessTokenResponse> = {
        token_type: "bearer",
        // scope     : clientDetailsToken.scope,
        client_id : client.client_id,
        expires_in: expiresIn
    };

    // access_token
    token.access_token = jwt.sign(token, config.jwtSecret, { expiresIn });

    // The authorization servers response must include the HTTP
    // Cache-Control response header field with a value of no-store,
    // as well as the Pragma response header field with a value of no-cache.
    res.set({
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
    });

    res.json(token);
}
