# bulk-import-consumer
Bulk Data Import Server (Data Consumer)

This server is an experimental prototype implementation of a Data Consumer
application, as defined in the [Bulk Data Ping and Pull Import Proposal](https://github.com/smart-on-fhir/bulk-import/blob/master/import-pnp.md). It is available
online [here](https://bulk-import-consumer.herokuapp.com/), but you will have more options if you run it locally.

The server behaves like a Bulk Data Client and consumes bulk-data NDJSON files.
The imported files are immediately discarded if using the online version. When
ran locally, it can also be configured to temporarily store the files in the 
filesystem, or to upload them to S3 bucket.

Also, the online version is configured to use the Bulk Data Reference 
Implementation server as data provider. To use other bulk data servers you will
have to run this app locally. 

## Installation
```sh
git clone https://github.com/smart-on-fhir/bulk-import-consumer.git
cd bulk-import-consumer
```

Once you are into the project folder, make sure you are using NodeJS >= 15. If
you have `nvm` just run `nvm use`. Then install the dependencies:
```sh
npm i
```
## Configuration
You need to set a fey configuration variables before the server is started.
There is an example configuration file `example.env` in the project root. Start
by renaming it to `.env` and then edit it as needed.

### Supported Configuration/Environment Variables
- `NODE_ENV` - (optional, string) Can be `production` or `development`. Defaults to `production`
- `PORT` - (optional, number) Defaults to `3001`
- `HOST` - (optional, string) Defaults to `localhost`
- `JOBS_PATH` - (optional, string) A path to a folder in which the import jobs are (temporarily) stored. Should be relative to the project root. Defaults to `jobs`
- `JOBS_ID_LENGTH` - (optional, number) The length of the random job ID, also used as a sub-folder name inside the `JOBS_PATH` folder. Defaults to `8`
- `JOBS_MAX_AGE` - (optional, number) Number of minutes after which the import jobs are deleted. If the server stores files in the file system, those files will be deleted as well. Note that this timeout is computed starting from the moment the import procedure is started, so make sure it is long enough for the import to be completed, plus some additional time for the files to be available if you need them. Defaults to `5`.
- `JSON_CONTENT_TYPES` - (optional, string) Comma-separated list of mime types types that should be recognized as JSON. I shouldn't need to change this one. Defaults to `application/json,application/fhir+json,application/json+fhir`
- `JWT_SECRET` - (**REQUIRED**, string) Random string secret used by the server to
sign tokens
- `ACCESS_TOKEN_EXPIRE_IN` - (optional, string) The lifespan of the access tokens
  issued by this server in minutes. Defaults to `5`.
- `NDJSON_MAX_LINE_LENGTH` - (optional, number) The longest (as number of characters) NDJSON line that we can parse without taking too much memory. Defaults to `500000`
- `PUBLIC_KEY` - (**REQUIRED**, string) The public key should be provided while registering this server as a client of a Data Provider
- `PRIVATE_KEY` - (**REQUIRED**, string) The private key used by this server as to sign tokens sent to `EXPORT_CLIENT_TOKEN_URL`. This should be a JWK as JSON string
- `EXPORT_CLIENT_SERVER_URL` - (**REQUIRED**, string) The base URL of the Data 
  Provider's (bulk data capable) FHIR server.
- `EXPORT_CLIENT_TOKEN_URL` - (**REQUIRED**, string) The token url of the Data Provider's auth server.
- `EXPORT_CLIENT_CLIENT_ID` - (**REQUIRED**, string) The client_id of this
  server as registered (as a client) with the data provider
- `DESTINATION_TYPE` - (optional, string) What to do with imported files. Options are:
    - `dev-null` (default) - discard them immediately
    - `tmp-fs` - store them in the file system. See `JOBS_PATH`, `JOBS_ID_LENGTH` and `JOBS_MAX_AGE`.
    - `s3` upload them to S3 bucket (see AWS options below)
    
- `AWS_S3_BUCKET_NAME` - (string, required if DESTINATION_TYPE is s3)
- `AWS_ACCESS_KEY_ID` - (string, required if DESTINATION_TYPE is s3)
- `AWS_SECRET_ACCESS_KEY` - (string, required if DESTINATION_TYPE is s3)
- `AWS_API_VERSION` - (string, required if DESTINATION_TYPE is s3) Can be 
  `2006-03-01` or `latest`. Defaults to `2006-03-01`.
- `AWS_REGION` - (string, required if DESTINATION_TYPE is s3) Defaults to `us-east-1`

## Usage
After the configuration is complete, start the server by running `npm start`.
Then open the URL printed in the terminal.

To trigger an import you should make a "ping" request to the server as described [here](https://github.com/smart-on-fhir/bulk-import/blob/master/import-pnp.md#bulk-data-import-kick-off-request-ping-from-data-provider-to-data-consumer).
The import kick-off endpoint of the server is `http://{HOST}:{PORT}/$import`.

You can use this server for testing, yf you are extending your Data Provider with import ping functionality. You can also try the sample import client from https://github.com/smart-on-fhir/bulk-import-client

## Client Registration
In order for an export and import to happen, both the Data Provider and Data consumer
need to be registered as clients of each other.
- The consumer needs to know the provider and allow it to send ping (import kick-off) requests.
- The provider needs to know the consumer and allow it to make bulk data exports.
- Both sides should use SMART backend services authentication

### 1. Adding clients to this server
There is a dedicated UI for that. Just start the server go to its URL (http://`HOST`:`PORT`).
The client should have a public and private keys. The private key is used by the client to sign
its authentication tokens. The server only needs to know the client's public key, which can be
provided in two ways:
- Static - At registration time as JWK
- Dynamic - At authentication time the server will fetch it from the JWKS URL provided
  during registration.
Once a public key is provided as `JWK` or `JWKS URI`, click "Register" and you'll get back a
`client_id` which the client should use to authenticate.

### 2. Registering this server as a client of a Data Provider
This is basically the same procedure but in reversed order.
1. You need to have a public/private key pair. The server already has those kays pre-configured. You can change/re-generate those kays if you want (see below).
    - Provide toy public key as JWK - you can find your public key in `PUBLIC_KEY` in your
      `.env` configuration file.
    - Provide a JWKS URL - your jwks url is `http://{HOST}:{PORT}/jwks`. Note that this will
      only work if this server is deployed on the internet. If it is running on localhost or
      in your local network, the Data Provider won't be able to access it.
2. Once you register this server as a client, update the following variables in the configuration file:
    - `EXPORT_CLIENT_SERVER_URL`
    - `EXPORT_CLIENT_TOKEN_URL`
    - `EXPORT_CLIENT_CLIENT_ID`

## Generating Keys
The server comes with a key generator which can also be used to generate its own keys. To do so:
1. Go to the server UI, open the generator, select an algorithm and click generate keys.
2. Copy the generated public and private keys (as JWK) and paste them as `PUBLIC_KEY` and `PRIVATE_KEY` in your config file.
3. Restart the server

WARNING: Once the keys are regenerated, you will have to do the registrations (described above)
again.
