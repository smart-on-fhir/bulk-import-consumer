import jose                 from "node-jose"
import got, { Got }         from "got"
import jwt                  from "jsonwebtoken"
import { Writable }         from "stream"
import { Parameters }       from "fhir/r4"
import { asArray, wait }    from "./lib"
import { CustomError }      from "./CustomError"
import { OperationOutcome } from "./OperationOutcome"
import { BulkData }         from "../types"

interface BulkDataClientOptions {
    clientId: string
    tokenUrl: string
    accessTokenLifetime: number
    privateKey: any,
    verbose?: boolean
}

export class BulkDataClient
{
    options: BulkDataClientOptions;

    accessToken: string;

    private request: Got;

    constructor(options: BulkDataClientOptions)
    {
        this.options = { verbose: true, ...options };

        this.request = got.extend({
            context: {
                verbose: this.options.verbose
            },
            hooks: {
                beforeRequest: [
                    options => {
                        if (options.context.verbose) {
                            console.log(`\n-----------------------------------------------------`)
                            console.log(`Request: ${options.method} ${options.url}`)
                            console.log(`Headers:`, options.headers)
        
                            const payload = options.body || options.form || options.json
                            if (payload) {
                                console.log("Payload:", payload)
                            }
                        }
                    }
                ],
                afterResponse: [
                    async (response, retryWithMergedOptions) => {
                        if (response.request.options.context.verbose) {
                            console.log(`Response Headers:`, response.headers)
                            if (response.body) {
                                console.log(`Response:`, response.body)
                            }
                            console.log(`-----------------------------------------------------\n`)
                        }
        
                        // Unauthorized
                        if (response.statusCode === 401 && !response.request.options.context.retried)
                        {
                            // Refresh the access token
                            const token = await this.authorize()
                            const updatedOptions = {
                                headers: {
                                    authorization: `bearer ${token}`
                                },
                                context: {
                                    retried: true
                                }
                            };
        
                            // Update the defaults
                            got.mergeOptions(response.request.options, updatedOptions);
        
                            // Make a new retry
                            return retryWithMergedOptions(updatedOptions);
                        }
        
                        return response
                    }
                ],
                beforeError: [
                    error => {
                        const { response } = error;
                        
                        if (typeof response?.body == "object") {
                            
                            // @ts-ignore OperationOutcome errors
                            if (response.body.resourceType === "OperationOutcome") {
                                const oo = response.body as fhir4.OperationOutcome
                                // @ts-ignore
                                error.severity = oo.issue[0].severity;
                                error.message = oo.issue[0].details?.text || oo.issue[0].diagnostics || response.statusMessage || "Unknown error"
                                error.code = oo.issue[0].code || response.statusCode + ""
                            }
        
                            // @ts-ignore OAuth errors
                            else if (response.body.error) {
                                // @ts-ignore
                                error.message = [response.body.error, response.body.error_description].filter(Boolean).join(": ")
                                error.code = response.statusCode + ""
                            }
                        }
        
                        return error;
                    }
                ]
            }
        });
    }

    async authorize()
    {
        const { clientId, tokenUrl, accessTokenLifetime, privateKey } = this.options;

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

        const { body } = await this.request<BulkData.TokenResponse>(tokenUrl, {
            method: "POST",
            responseType: "json",
            form: {
                scope: "system/*.*",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: token
            }
        });

        return body.access_token;
    }
    
    async kickOff(kickOffUrl: string, params: BulkData.KickOfParams = {}): Promise<BulkData.KickOffResponse>
    {
        const body: Parameters = {
            resourceType: "Parameters",
            parameter: []
        }
        
        // _since (single valueInstant parameter) ----------------------------------
        if (params._since) {
            body.parameter.push({
                name: "_since",
                valueInstant: params._since
            });
        }

        // _outputFormat (single valueString parameter) ----------------------------
        if (params._outputFormat) {
            body.parameter.push({
                name: "_outputFormat",
                valueString: params._outputFormat
            });
        }

        // patient (sent as one or more valueReference params) ---------------------
        if (params.patient) {
            body.parameter = body.parameter.concat(
                asArray(params.patient).map((id: any) => ({
                    name : "patient",
                    valueReference : { reference: `Patient/${id}` }
                }))
            );
        }

        // _type (sent as one or more valueString params) --------------------------
        if (params._type) {
            body.parameter = body.parameter.concat(
                asArray(params._type).map((type: any) => ({
                    name: "_type",
                    valueString: type
                }))
            );
        }

        // _elements (sent as one or more valueString params) ----------------------
        if (params._elements) {
            body.parameter = body.parameter.concat(
                asArray(params._elements).map((type: any) => ({
                    name: "_elements",
                    valueString: type
                }))
            );
        }

        // _typeFilter (sent as one or more valueString params) --------------------
        if (params._typeFilter) {
            body.parameter = body.parameter.concat(
                asArray(params._typeFilter).map((type: any) => ({
                    name: "_typeFilter",
                    valueString: type
                }))
            );
        }

        // includeAssociatedData (sent as one or more valueString params) ----------
        if (params.includeAssociatedData) {
            body.parameter = body.parameter.concat(
                asArray(params.includeAssociatedData).map((type: any) => ({
                    name: "includeAssociatedData",
                    valueString: type
                }))
            );
        }
        
        if (!this.accessToken) {
            this.accessToken = await this.authorize()
        }

        return this.request(kickOffUrl, {
            json: body,
            method: "POST",
            followRedirect: false,
            // throwHttpErrors: false,
            headers: {
                accept       : "application/fhir+json",
                prefer       : "respond-async",
                authorization: `Bearer ${ this.accessToken }`
            }
        });
    }

    async waitForExport(kickOffResponse: BulkData.KickOffResponse, onProgress?: (pct: number) => any): Promise<BulkData.ExportManifest>
    {
        const contentLocation = kickOffResponse.headers["content-location"] + "";

        if (!contentLocation) {
            throw new CustomError(
                400,
                "Trying to wait for export but the kick-off " +
                "response did not include a content-location header."
            );
        }

        if (!this.accessToken) {
            this.accessToken = await this.authorize()
        }

        const { body, statusCode, headers } = await this.request<BulkData.ExportManifest>(contentLocation, {
            responseType: "json",
            headers: {
                authorization: `Bearer ${ this.accessToken }`
            }
        });

        if (statusCode !== 200) {
            onProgress && await onProgress(parseFloat(headers["x-progress"] + "" || "0"))
            await wait(1000);
            return this.waitForExport(kickOffResponse, onProgress);
        }

        await wait(100);
        onProgress && await onProgress(100)
        return body
    }

    downloadFile(descriptor: BulkData.ExportManifestFile)
    {
        const out = {
            stream: () => {
                return this.request.stream(descriptor.url, {
                    context: {
                        verbose: this.options.verbose
                    },
                    headers: {
                        authorization: `Bearer ${ this.accessToken }`
                    }
                });
            },
            promise: (destination: Writable) => {
                return new Promise((resolve, reject) => {
                    const source = out.stream();
                    let pipeline: Writable = source.pipe(destination);
                    pipeline.once("finish", resolve);
                    pipeline.once("error", e => reject(new OperationOutcome(e.message, 500)));
                });
            }
        };

        return out
    }
}
