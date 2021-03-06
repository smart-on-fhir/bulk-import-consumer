import { Response } from "got"
import { Algorithm } from "jsonwebtoken";

type ProblemSeverity = "fatal" | "error" | "warning" | "information"

export namespace ImportServer {

    export interface JWK {
        alg: Algorithm
        [key: string]: any
    }

    export interface JWKS {
        keys: JWK[]
    }

    export interface Client {
        /**
         * A JWKS object containing the public key(s) used to verify the
         * signature of the incoming bearer tokens. This is required if
         * `jwks_uri` is not set.
         */
        jwks?: JWKS

        /**
         * URL to public location at which the public keys of the client
         * system are available as JWKS json object. This is required if
         * `jwks` is not set. 
         */
        jwks_uri?: string

        /**
         * The unique ID of the client
         */
        client_id: string

        /**
         * The client_id of the consumer that should be used while importing
         * data from the provider.
         */
        consumer_client_id: string

        /**
         * The base URL of the data provider's FHIR server
         */
        aud: string
    }

    interface Config {
        port: number
        host: string

        /**
         * How many utf8 characters can be put in (parsed from) single ndjson
         * line without hitting memory limits
         */
        ndjsonMaxLineLength: number

        /**
         * A template string used to compute the name of the downloaded files.
         * 
         * Available variables:
         * - `originalName` - The filename as reported by the data provider
         * - `resourceType` - The ResourceType of the resources in this file
         * - `jobId`        - The unique ID of the current import job
         * - `fileNumber`   - The file number. It would be `1` or bigger if we
         *                    have multiple files of the same type.
         * 
         * Examples:
         * - `"{originalName}"` - preserve the original name
         * - `"{fileNumber}.{resourceType}.ndjson"` - enforce the traditional
         *   naming of bulk data files
         * 
         * Defaults to "{originalName}"
         * 
         * NOTE: `jobId` can be used when the destination is an S3 bucket to
         * put the files into jobId subfolder
         * (for example: `{jobId}/{fileNumber}.{resourceType}.ndjson`). If the
         * destination is local FS, files will go into jobId subfolder by
         * default and using jobId in the template does not make sense.
         */
        downloadFileName: string

        /**
         * If not "none", download referenced attachments and put them inline as
         * base64 (for DocumentReference resources only).
         * Value can be "none" (default), "all", or an array of mime types which
         * should be inlined.
         */
        inlineAttachments: "all" | "none" | string[]

        /**
         * Access tokens lifetime in minutes
         */
        accessTokensExpireIn: number

        /**
         * Use this to sign tokens
         */
        jwtSecret: string

        /**
         * Import jobs lifetime in minutes.
         * The import jobs will expire after this interval and will be deleted,
         * along with any imported files (if files are being imported to the
         * filesystem)
         */
        jobsMaxAge: number

        /**
         * The jobsMaxAge is computed since the import was completed. However,
         * if a job has been started but failed to complete for some reason,
         * we consider it a zombie job which can be given more time but still
         * needs to be killed after that. By default we use `jobsMaxAge * 2`
         * for the absolute max age.
         */
        jobsMaxAbsoluteAge: number

        /**
         * Content types recognized as JSON
         */
        jsonContentTypes: string[]

        /**
         * The length of the generated job id (used for folder names)
         */
        jobsIdLength: number

        /**
         * Directory in which we temporarily persist our import jobs
         */
        jobsPath: string

        /**
         * The public key of this server
         */
        publicKey: JWK
        
        /**
         * The private key of this server
         */
        privateKey: JWK


        destination: {
            /**
             * - "dev-null" (default) - discard downloaded files and don't store
             *   anything
             * - "tmp-fs" - store downloaded files to `{config.jobsPath}/{job.id}/`
             *   Those files are automatically deleted after `config.jobsMaxAge`
             *   minutes
             * - "s3" - upload imported files to s3 bucket using the
             *   configuration provided in `options`
             */
            type: "tmp-fs" | "dev-null" | "s3"

            /**
             * Destination options if the destination type requires some.
             * Currently only "s3" requires options
             */
            options: {
                bucketName: string
            }
        },

        aws: {
            apiVersion: string
            region: string
            accessKeyId: string
            secretAccessKey: string
        }
    }

    interface ImportJobState {
        /**
         * Unique ID of the instance. Used as a file name when persisting the
         * instance in a file.
         */
        id: string;
    
        /**
         * Timestamp of the instance creation time. Used when we clean up old jobs.
         */
        createdAt: number;
    
        /**
         * Timestamp of the moment when the import was completed.
         */
        completedAt?: number;
    
        exportUrl?: string;
        exportStatusLocation?: string;
        exportParams?: Record<string, any>;
        manifest?: BulkData.ExportManifest;
    
        exportProgress?: number
        importProgress?: number
        status?: string
    
        exportType: "dynamic" | "static"
    
        outcome: fhir4.OperationOutcome[]
    
        // aborted?: boolean
        bulkDataClientInstanceId?: string
    
        // clientId?: string
        // consumerClientId?: string
        // providerBaseUrl?: string
        client: ImportServer.Client
    }
}

export namespace BulkData {
    /**
     * The response expected upon successful kick-off and status pulling 
     */
    export interface ExportManifest {
            
        /**
         * indicates the server's time when the query is run. The response
         * SHOULD NOT include any resources modified after this instant,
         * and SHALL include any matching resources modified up to and
         * including this instant.
         * Note: To properly meet these constraints, a FHIR Server might need
         * to wait for any pending transactions to resolve in its database
         * before starting the export process.
         */
        transactionTime: string // FHIR instant

        /**
         * the full URL of the original bulk data kick-off request
         */
        request: string

        /**
         * indicates whether downloading the generated files requires a
         * bearer access token.
         * Value SHALL be true if both the file server and the FHIR API server
         * control access using OAuth 2.0 bearer tokens. Value MAY be false for
         * file servers that use access-control schemes other than OAuth 2.0,
         * such as downloads from Amazon S3 bucket URLs or verifiable file
         * servers within an organization's firewall.
         */
        requiresAccessToken: boolean
        
        /**
         * an array of file items with one entry for each generated file.
         * If no resources are returned from the kick-off request, the server
         * SHOULD return an empty array.
         */
        output: ExportManifestFile[]

        /**
         * array of error file items following the same structure as the output
         * array.
         * Errors that occurred during the export should only be included here
         * (not in output). If no errors occurred, the server SHOULD return an
         * empty array. Only the OperationOutcome resource type is currently
         * supported, so a server SHALL generate files in the same format as
         * bulk data output files that contain OperationOutcome resources.
         */
        error: ExportManifestFile<"OperationOutcome">[]

        /**
         * An array of deleted file items following the same structure as the
         * output array.
         * 
         * When a `_since` timestamp is supplied in the export request, this
         * array SHALL be populated with output files containing FHIR
         * Transaction Bundles that indicate which FHIR resources would have
         * been returned, but have been deleted subsequent to that date. If no
         * resources have been deleted or the _since parameter was not supplied,
         * the server MAY omit this key or MAY return an empty array.
         * 
         * Each line in the output file SHALL contain a FHIR Bundle with a type
         * of transaction which SHALL contain one or more entry items that
         * reflect a deleted resource. In each entry, the request.url and
         * request.method elements SHALL be populated. The request.method
         * element SHALL be set to DELETE.
         * 
         * Example deleted resource bundle (represents one line in output file):
         * @example 
         * ```json
         * {
         *     "resourceType": "Bundle",
         *     "id": "bundle-transaction",
         *     "meta": { "lastUpdated": "2020-04-27T02:56:00Z" },
         *     "type": "transaction",
         *     "entry":[{
         *         "request": { "method": "DELETE", "url": "Patient/123" }
         *         ...
         *     }]
         * }
         * ```
         */
        deleted?: ExportManifestFile<"Bundle">[]

        /**
         * To support extensions, this implementation guide reserves the name
         * extension and will never define a field with that name, allowing
         * server implementations to use it to provide custom behavior and
         * information. For example, a server may choose to provide a custom
         * extension that contains a decryption key for encrypted ndjson files.
         * The value of an extension element SHALL be a pre-coordinated JSON
         * object.
         */
        extension?: Record<string, any>
    }

    /**
     * Each file or output entry in export manifest
     */
    export interface ExportManifestFile<Type = string> {
        
        /**
         * the FHIR resource type that is contained in the file.
         * Each file SHALL contain resources of only one type, but a server MAY
         * create more than one file for each resource type returned. The number
         * of resources contained in a file MAY vary between servers. If no data
         * are found for a resource, the server SHOULD NOT return an output item
         * for that resource in the response. These rules apply only to top-level
         * resources within the response; as always in FHIR, any resource MAY
         * have a "contained" array that includes referenced resources of other
         * types.
         */
        type: Type

        /**
         * the path to the file. The format of the file SHOULD reflect that
         * requested in the _outputFormat parameter of the initial kick-off
         * request.
         */
        url: string 

        /**
         * the number of resources in the file, represented as a JSON number.
         */
        count?: number
    }

    // export type StatusResponse<T=ExportManifest | OperationOutcome | void> = Response<T>

    export interface KickOfParams {
        _since               ?: string
        _outputFormat        ?: string
        patient              ?: (number|string) | (number|string)[]
        _type                ?: string | string[]
        _elements            ?: string | string[]
        includeAssociatedData?: string | string[]
        _typeFilter          ?: string | string[]
    }

    export type KickOffResponse = Response<any>;

    interface ImportResult {
        transactionTime: string
        requiresAccessToken: boolean
        outcome: ImportOutcome[]
        extension?: JsonObject
    }
    
    interface ImportOutcome {
        extension?: JsonObject
        url: string
        count?: number
    }

    interface TokenResponse {
        access_token: string
    }
}

export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;
export type JsonArray = JsonValue[];
