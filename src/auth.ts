import { NextFunction, Request, Response }    from "express"
import util                                   from "util"
import { RequestOptions }                     from "http"
import jwt                                    from "jsonwebtoken"
import jose                                   from "node-jose"
import got                                    from "./request"
import config                                 from "./config"
import { CustomError }                        from "./CustomError"
import { getRequestBaseURL }                  from "./lib"
import { OAuthError }                         from "./OAuthError"
import { BulkData, ImportServer, JsonObject } from "../types"
import { CancelableRequest, Response as GotResponse } from "got/dist/source"

const debug             = util.debuglog("app")
const debugIncomingAuth = util.debuglog("app-auth-incoming")
const debugOutgoingAuth = util.debuglog("app-auth-outgoing")


const httpCache = new Map();


/**
 * Returns a decoded version of the access token obtained from the `Authorization`
 * header of the incoming request. Verifies that:
 * - The request has an `Authorization` header (auth is required)
 * - The token type is `bearer`
 * - The bearer access token is signed by us and not modified
 * - The bearer access token is not expired
 * If any of the above is false, throws a CustomError
 */
export function getRequestToken(req: Request): jwt.JwtPayload
{
    debugIncomingAuth("getRequestToken -> requested url: %s %s, query: %j", req.method, req.url, req.query)

    // Verify that authorization header is present
    const header = String(req.headers.authorization || "")
    debugIncomingAuth("getRequestToken -> authorization header: %s", header)

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
        debugIncomingAuth("getRequestToken -> decoded access token: %j", decoded)
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
 * 
 * Validates the incoming access token and extracts and returns the client
 * information from it.
 */
export async function authorizeIncomingRequest(req: Request)
{
    // 1. Get the bearer token from the authorization header
    const token = getRequestToken(req)

    // 2. Get the clientId from the token
    try {
        var client = jwt.decode(token.client_id) as ImportServer.Client
        debugIncomingAuth("authorizeIncomingRequest -> client extracted from access token: %o", client)
    } catch (ex) {
        throw new OAuthError(400, "invalid_client", "Invalid client_id token. " + ex.message)
    }

    return client
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

    let { jwks, jwks_uri, consumer_client_id, aud } = req.body

    if (!jwks && !jwks_uri) {
        return next(new OAuthError(400, "invalid_request", "Either 'jwks' or 'jwks_uri' parameter is required"))
    }

    if (!consumer_client_id) {
        return next(new OAuthError(400, "invalid_request", "'consumer_client_id' parameter is required"))
    }

    if (!aud) {
        return next(new OAuthError(400, "invalid_request", "The base URL of the data provider ('aud' parameter) is required"))
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
    let jwtToken: Partial<ImportServer.Client> = {
        consumer_client_id,
        aud
    }

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

    // jwtToken.iss = clientId

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
    debugIncomingAuth("tokenHandler -> received authorization request")
    const {
        originalUrl,
        body: {
            client_assertion_type,
            client_assertion
        }
    } = req; // console.log(req.body)

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
        debugIncomingAuth("tokenHandler -> auth token claims: %o", authenticationToken)
    } catch (ex) {
        return next(new OAuthError(400, "invalid_request", "Invalid client_assertion. " + ex.message))
    }

    // The client_id must be valid token too
    try {
        var client = jwt.verify(authenticationToken.sub, config.jwtSecret) as ImportServer.Client
        debugIncomingAuth("tokenHandler -> client: %o", client)
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
        return next(new OAuthError(400, "invalid_request", "Invalid 'aud'. Expected %s but got %s", aud, authenticationToken.aud))
    }

    if (authenticationToken.iss !== authenticationToken.sub) {
        return next(new OAuthError(400, "invalid_request", "Invalid 'iss' or 'sub' token claim"))
    }

    const expiresIn = config.accessTokensExpireIn * 60;

    var token: Partial<AccessTokenResponse> = {
        token_type: "bearer",
        // scope     : clientDetailsToken.scope,
        // client_id : client.client_id,
        client_id : authenticationToken.sub,
        expires_in: expiresIn
    };

    // access_token
    token.access_token = jwt.sign(token, config.jwtSecret, { expiresIn });

    debugIncomingAuth("tokenHandler -> successful authorization. Access token response: %o", token)

    // The authorization servers response must include the HTTP
    // Cache-Control response header field with a value of no-store,
    // as well as the Pragma response header field with a value of no-cache.
    res.set({
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
    });

    res.json(token);
}

export async function getWellKnownSmartConfig(baseUrl: string) {
    const url = new URL(".well-known/smart-configuration", baseUrl.replace(/\/*$/, "/"));
    return got<JsonObject>(url, { responseType: "json", cache: httpCache });
}

export async function getCapabilityStatement(baseUrl: string) {
    const url = new URL("metadata", baseUrl.replace(/\/*$/, "/"));
    return got<fhir4.CapabilityStatement>(url, { responseType: "json", cache: httpCache });
}

export async function getTokenEndpointFromWellKnownSmartConfig(baseUrl: string) {
    const { body } = await getWellKnownSmartConfig(baseUrl);
    return body.token_endpoint as string || null
}

export async function getTokenEndpointFromCapabilityStatement(baseUrl: string) {
    const oauthUrisUrl = "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris"
    const { body } = await getCapabilityStatement(baseUrl);
    const rest = body.rest.find(x => x.mode === "server");
    const ext = rest.security.extension.find(x => x.url === oauthUrisUrl).extension
    const node = ext.find(x => x.url === "token")
    return node.valueUri || node.valueUrl || node.valueString || null
}

/**
 * Given a FHIR server baseURL, looks up its `.well-known/smart-configuration`
 * and/or its `CapabilityStatement` (whichever arrives first) and resolves with
 * the token endpoint as defined there.
 * @param baseUrl The base URL of the FHIR server
 */
export async function getTokenEndpointFromBaseUrl(baseUrl: string): Promise<string | null> {
    return Promise.any([
        getTokenEndpointFromWellKnownSmartConfig(baseUrl).then(
            url => {
                debug("Detected token URL from .well-known/smart-configuration: %s", url)
                return url
            },
            e => {
                debug(
                    "Failed to fetch .well-known/smart-configuration from %s",
                    baseUrl,
                    e.response?.statusCode,
                    e.response?.statusMessage
                );
                throw e
            }
        ),
        getTokenEndpointFromCapabilityStatement(baseUrl).then(
            url => {
                debug("Detected token URL from CapabilityStatement: %s", url)
                return url
            },
            e => {
                debug(
                    "Failed to fetch CapabilityStatement from %s",
                    baseUrl,
                    e.response?.statusCode,
                    e.response?.statusMessage
                );
                throw e
            }
        )
    ]).catch(() => null);
}

/**
 * Makes a Backend Services authorization request against the given server.
 * NOTE that if we were to await the got call we will automatically await the
 * request itself and get the response, loosing the reference to the cancelable
 * request. To avoid that, this function resolves with an object having the
 * request as its only property.
 * @param options
 * @param options.clientId The client_id to present ourselves with
 * @param options.baseUrl The base URL of the FHIR server to authorize against
 * @param options.privateKey The privateKey to sign out auth token with
 * @param options.accessTokenLifetime In seconds. Defaults to 300 (5 min)
 * @param options.verbose If true logs request details to console
 */
export async function authorize(options: {
    clientId: string
    baseUrl: string
    privateKey: ImportServer.JWK
    accessTokenLifetime?: number
    verbose?: boolean
}): Promise<{ request: CancelableRequest<GotResponse<BulkData.TokenResponse>> }>
{
    const { clientId, baseUrl, accessTokenLifetime = 300, privateKey } = options;

    const tokenUrl = await getTokenEndpointFromBaseUrl(baseUrl)

    const claims = {
        iss: clientId,
        sub: clientId,
        aud: tokenUrl,
        exp: Math.round(Date.now() / 1000) + accessTokenLifetime,
        jti: jose.util.randomBytes(10).toString("hex")
    };

    const key = await jose.JWK.asKey(privateKey, "json");

    const token = jwt.sign(claims, key.toPEM(true), {
        algorithm: key.alg as jwt.Algorithm,
        keyid: key.kid
    });

    debugOutgoingAuth("authorize -> making authorization request to %s", tokenUrl)
    debugOutgoingAuth("authorize -> auth token claims: %o", claims)

    return {
        request: got<BulkData.TokenResponse>(tokenUrl, {
            method: "POST",
            responseType: "json",
            form: {
                scope: "system/*.*",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: token
            }
        })
    };
}

export function getAccessTokenExpiration(tokenResponse: any): number
{
    const now = Math.floor(Date.now() / 1000);

    // Option 1 - using the expires_in property of the token response
    if (tokenResponse.expires_in) {
        return now + tokenResponse.expires_in;
    }

    // Option 2 - using the exp property of JWT tokens (must not assume JWT!)
    if (tokenResponse.access_token) {
        let tokenBody = jwt.decode(tokenResponse.access_token);
        if (tokenBody && typeof tokenBody == "object" && tokenBody.exp) {
            return tokenBody.exp;
        }
    }

    // Option 3 - if none of the above worked set this to 5 minutes after now
    return now + 300;
}
