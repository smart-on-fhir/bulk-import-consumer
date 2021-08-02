"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts_dotenv_1 = require("ts-dotenv");
const path_1 = require("path");
const schema = {
    NODE_ENV: {
        type: String,
        optional: true,
        default: "production"
    },
    PORT: {
        type: Number,
        optional: true,
        default: 3001
    },
    HOST: {
        type: String,
        optional: true,
        default: "localhost"
    },
    JOBS_PATH: {
        type: String,
        optional: true,
        default: "jobs"
    },
    JOBS_ID_LENGTH: {
        type: Number,
        optional: true,
        default: 8
    },
    JOBS_MAX_AGE: {
        type: Number,
        optional: true,
        default: 5
    },
    JSON_CONTENT_TYPES: {
        type: String,
        optional: true,
        default: "application/json,application/fhir+json,application/json+fhir"
    },
    JWT_SECRET: {
        type: String,
        optional: false
    },
    ACCESS_TOKEN_EXPIRE_IN: {
        type: Number,
        optional: true,
        default: 5
    },
    NDJSON_MAX_LINE_LENGTH: {
        type: Number,
        optional: true,
        default: 500000
    },
    EXPORT_CLIENT_SERVER_URL: {
        optional: false,
        type: String
    },
    EXPORT_CLIENT_TOKEN_URL: {
        optional: false,
        type: String
    },
    EXPORT_CLIENT_CLIENT_ID: {
        optional: false,
        type: String
    },
    PRIVATE_KEY: {
        optional: false,
        type: String
    },
    PUBLIC_KEY: {
        optional: false,
        type: String
    },
    // Can be "dev-null", "tmp-fs" or "s3"
    // In case of "s3" the AWS_... options below are also required
    DESTINATION_TYPE: {
        type: String,
        optional: true,
        default: "dev-null"
    },
    AWS_S3_BUCKET_NAME: {
        type: String,
        optional: true,
        default: ""
    },
    AWS_ACCESS_KEY_ID: {
        type: String,
        optional: true,
        default: ""
    },
    AWS_SECRET_ACCESS_KEY: {
        type: String,
        optional: true,
        default: ""
    },
    AWS_API_VERSION: {
        type: String,
        optional: true,
        default: "2006-03-01"
    },
    AWS_REGION: {
        type: String,
        optional: true,
        default: "us-east-1"
    }
};
const env = ts_dotenv_1.load(schema);
// console.log(env)
const config = {
    port: env.PORT,
    host: env.HOST,
    jobsPath: path_1.join(__dirname, "..", env.JOBS_PATH),
    jobsIdLength: env.JOBS_ID_LENGTH,
    jobsMaxAge: env.JOBS_MAX_AGE,
    jsonContentTypes: env.JSON_CONTENT_TYPES.trim().split(/\s*,\s*/),
    jwtSecret: env.JWT_SECRET,
    accessTokensExpireIn: env.ACCESS_TOKEN_EXPIRE_IN,
    ndjsonMaxLineLength: env.NDJSON_MAX_LINE_LENGTH,
    publicKey: JSON.parse(env.PUBLIC_KEY),
    privateKey: JSON.parse(env.PRIVATE_KEY),
    exportClient: {
        serverURL: env.EXPORT_CLIENT_SERVER_URL,
        tokenURL: env.EXPORT_CLIENT_TOKEN_URL,
        clientId: env.EXPORT_CLIENT_CLIENT_ID,
    },
    destination: {
        type: env.DESTINATION_TYPE,
        options: {
            bucketName: env.AWS_S3_BUCKET_NAME
        }
    },
    aws: {
        apiVersion: "2006-03-01",
        region: "us-east-1",
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
};
exports.default = config;
