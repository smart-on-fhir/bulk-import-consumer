"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenHandler = exports.registrationHandler = exports.authorizeOutgoingRequest = exports.authorizeIncomingRequest = exports.getRequestToken = void 0;
const source_1 = __importDefault(require("got/dist/source"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const node_jose_1 = __importDefault(require("node-jose"));
const config_1 = __importDefault(require("./config"));
const CustomError_1 = require("./CustomError");
const lib_1 = require("./lib");
const OAuthError_1 = require("./OAuthError");
function getRequestToken(req) {
    // Verify that authorization header is present
    const header = String(req.headers.authorization || "");
    if (!header) {
        throw new CustomError_1.CustomError(401, "Authorization is required", "fatal");
    }
    // Verify that the authorization header contains bearer token (not empty)
    const token = header.replace(/^\s*bearer\s+/i, "");
    if (!token) {
        throw new CustomError_1.CustomError(403, "Invalid authorization header", "fatal");
    }
    // Decode the token
    try {
        var decoded = jsonwebtoken_1.default.verify(token, config_1.default.jwtSecret);
    }
    catch (ex) {
        throw new CustomError_1.CustomError(403, "Invalid authorization token: " + ex.message, "fatal");
    }
    return decoded;
}
exports.getRequestToken = getRequestToken;
/**
 * When SMART Backend Services Authorization is used to authorize Data Provider
 * to Data Consumer requests (the initial "ping" and subsequent status checks),
 * the Data Provider will need to be pre-registered with the Data Consumer as a
 * client so the Data Consumer can store the Data Provider's public key
 * information (the key itself or the location of a jwks file) and assign an
 * associated client_id for use in the authorization process.
 */
async function authorizeIncomingRequest(req) {
    // 1. Get the bearer token from the authorization header
    const token = getRequestToken(req);
    // console.log(token)
    // // 2. Get the clientId from the token
    // try {
    //     var client = jwt.verify(token.sub, config.jwtSecret) as ImportServer.Client
    // } catch (ex) {
    //     throw new OAuthError(400, "invalid_client", "Invalid client_id token. " + ex.message)
    // }
    return token;
}
exports.authorizeIncomingRequest = authorizeIncomingRequest;
/**
 * When SMART Backend Services Authorization is used to authorize Data Consumer
 * to Data Provider requests (the full or abbreviated Bulk Data Export flow),
 * the Data Consumer will need to be pre-registered with the Data Provider as a
 * client so the Data Provider can store Data Consumer's public key information
 * and assign an associated a client_id for use in the authorization process.
 */
function authorizeOutgoingRequest(requestOptions, consumerClientId) {
    return {
        ...requestOptions,
        headers: {
            ...requestOptions.headers,
            authorization: "bearer " + btoa(consumerClientId)
        }
    };
}
exports.authorizeOutgoingRequest = authorizeOutgoingRequest;
async function registrationHandler(req, res, next) {
    // Require "application/json" POSTs
    if (!req.is("application/json")) {
        return next(new OAuthError_1.OAuthError(400, "invalid_request", "The content type must be application/json"));
    }
    let { jwks, jwks_uri } = req.body;
    if (!jwks && !jwks_uri) {
        return next(new OAuthError_1.OAuthError(400, "invalid_request", "Either 'jwks' or 'jwks_uri' parameter is required"));
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
    let jwtToken = {};
    if (jwks) {
        jwtToken.jwks = jwks;
    }
    else {
        jwtToken.jwks_uri = jwks_uri;
    }
    // // Note that if dur is 0 accessTokensExpireIn will not be included
    // if (dur) {
    //     jwtToken.accessTokensExpireIn = dur
    // }
    // // Custom errors (if any)
    // if (req.body.auth_error) {
    //     jwtToken.auth_error = req.body.auth_error
    // }
    const clientId = jsonwebtoken_1.default.sign(jwtToken, config_1.default.jwtSecret);
    jwtToken.iss = clientId;
    res.set({
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
    });
    res.json({
        client_id: clientId,
        client_id_issued_at: Math.round(Date.now() / 1000),
        token_endpoint: lib_1.getRequestBaseURL(req) + "/auth/token"
    });
}
exports.registrationHandler = registrationHandler;
async function getPublicKeys(jwksOrUri) {
    if (typeof jwksOrUri === "string") {
        try {
            var { keys } = await source_1.default(jwksOrUri, {
                resolveBodyOnly: true,
                responseType: "json"
            });
        }
        catch (ex) {
            throw new Error(`Failed to get public key(s) from JWKS URL "${jwksOrUri}". ${ex.message}`);
        }
        if (!Array.isArray(keys) || !keys.length) {
            throw new Error(`Failed to get public key(s) from JWKS URL "${jwksOrUri}"`);
        }
        return keys;
    }
    return jwksOrUri.keys;
}
/**
 * Handles the backend service authorization requests. Parses and validates
 * input params and eventually calls this.finish() with the parsed client
 * details token.
 */
async function tokenHandler(req, res, next) {
    const { originalUrl, body: { client_assertion_type, client_assertion } } = req;
    const algorithms = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"];
    const aud = lib_1.getRequestBaseURL(req) + originalUrl;
    // client_assertion_type is required
    if (!client_assertion_type) {
        return next(new OAuthError_1.OAuthError(400, "invalid_request", "client_assertion_type parameter is required"));
    }
    // client_assertion_type must have a fixed value
    if (client_assertion_type !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") {
        return next(new OAuthError_1.OAuthError(400, "invalid_request", "client_assertion_type must be 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'"));
    }
    // client_assertion must be a sent
    if (!client_assertion) {
        return next(new OAuthError_1.OAuthError(400, "invalid_request", "Missing client_assertion parameter"));
    }
    // client_assertion must be valid JWT
    try {
        var authenticationToken = jsonwebtoken_1.default.decode(client_assertion);
    }
    catch (ex) {
        return next(new OAuthError_1.OAuthError(400, "invalid_request", "Invalid client_assertion. " + ex.message));
    }
    // The client_id must be valid token too
    try {
        var client = jsonwebtoken_1.default.verify(authenticationToken.sub, config_1.default.jwtSecret);
    }
    catch (ex) {
        return next(new OAuthError_1.OAuthError(400, "invalid_client", "Invalid client_id token. " + ex.message));
    }
    // Now that we have the client, get its public key and verify the auth token
    try {
        const clientPublicKeys = await getPublicKeys(client.jwks_uri || client.jwks);
        await Promise.any(clientPublicKeys.map(key => {
            return node_jose_1.default.JWK.asKey(key, "json")
                .then(jwk => jwk.toPEM())
                .then(pem => jsonwebtoken_1.default.verify(client_assertion, pem, { algorithms }));
        })).catch(() => {
            throw new Error(`None of the (${clientPublicKeys.length}) public keys could verify the token`);
        });
    }
    catch (ex) {
        return next(new OAuthError_1.OAuthError(400, "invalid_client", "Invalid client public key(s). " + ex.message));
    }
    // Validate authenticationToken.aud (must equal this url)
    if (aud.replace(/^https?/, "") !== authenticationToken.aud.replace(/^https?/, "")) {
        return next(new OAuthError_1.OAuthError(400, "invalid_request", "Invalid 'aud'"));
    }
    if (authenticationToken.iss !== authenticationToken.sub) {
        return next(new OAuthError_1.OAuthError(400, "invalid_request", "Invalid 'iss' or 'sub' token claim"));
    }
    const expiresIn = config_1.default.accessTokensExpireIn * 60;
    var token = {
        token_type: "bearer",
        // scope     : clientDetailsToken.scope,
        client_id: client.client_id,
        expires_in: expiresIn
    };
    // access_token
    token.access_token = jsonwebtoken_1.default.sign(token, config_1.default.jwtSecret, { expiresIn });
    // The authorization servers response must include the HTTP
    // Cache-Control response header field with a value of no-store,
    // as well as the Pragma response header field with a value of no-cache.
    res.set({
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
    });
    res.json(token);
}
exports.tokenHandler = tokenHandler;
