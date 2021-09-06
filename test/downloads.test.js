const request = require("supertest");
const nock    = require("nock");
const jose    = require("node-jose");
const jwt     = require("jsonwebtoken");
const got     = require("got").default;
const app     = require("../build/index");
const { wait } = require("../build/lib");



// const BulkDataServer = nock("http://www.example.com");

// BulkDataServer.get("/$export").reply(202, '', { "content-location": "http://www.example.com/status" });

// BulkDataServer.get("/status").reply(200, {
//     "transactionTime": "[instant]",
//     "request" : "http://www.example.com/$export",
//     "requiresAccessToken" : false,
//     "output" : [{
//       "type" : "Patient",
//       "url" : "http://www.example.com/download/file_1.ndjson"
//     }],
//     "error" : []
// })

// BulkDataServer.get("/download/:file").reply(200, '{resourceType:"Patient"}\n{resourceType:"Patient"}')




describe.skip("IMPORT", () => {

    let rootReq;

    let AGENT;

    const BulkDataServerHost = "http://www.example.com";

    /**
     * The URL on which the import consumer server is running. Note that while
     * we know this will be on localhost, it will be on random port
     */
    let BASE_URL;
    
    /**
     * The JWK to use (it can be used to extract both public and private key)
     */
    let KEY;

    /**
     * Register new client before testing to get this client ID
     */
    let CLIENT_ID;
    
    let ACCESS_TOKEN;

    async function createKey() {
        return jose.JWK.createKey("RSA", 2048, { alg: "RS384" });
    }
    
    async function register(publicKey, aud="https://whatever.dev/aud", consumer_client_id="test-consumer-client-id") {
        return AGENT
            .post("/auth/register")
            .type("json")
            .send({
                jwks: { keys: [ publicKey ] },
                consumer_client_id,
                aud
            })
            .expect('Content-Type', /json/)
            .expect(200)
            .expect(/"client_id":".+?\..+?\..+?"/)
            .then(res => res.body.client_id);
    }
    
    /**
     * 
     * @param {object} options
     * @param {string} options.clientId The client ID we got back from `register()`
     * @param {string} options.tokenUrl The tokenUrl to authorize against
     * @param {string} options.privateKey The private key to sign our token with (as PEM)
     * @returns {Promise<string>} Resolves with the access token
     */
    async function authorize({ clientId, tokenUrl, privateKey }) {
        
        const claims = {
            iss: clientId,
            sub: clientId,
            aud: tokenUrl,
            exp: Math.round(Date.now() / 1000) + 600,
            jti: jose.util.randomBytes(10).toString("hex")
        };
    
        const token = jwt.sign(claims, privateKey, { algorithm: "RS384" });
    
        return AGENT
            .post("/auth/token")
            .type("form")
            .send({
                scope: "system/*.*",
                grant_type: "client_credentials",
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: token
            })
            .expect('Content-Type', /json/)
            .expect(200)
            .expect(/"access_token"/)
            .then(res => res.body.access_token)
            .catch(console.error)
    }
    

    // TODO: Register before testing
    beforeEach(async () => {
        
        rootReq = request(app).get('/');

        BASE_URL = rootReq.url.replace(/\/$/, "");

        AGENT = request(BASE_URL);

        KEY = await createKey();
        
        CLIENT_ID = await register(KEY.toJSON(false), `${BASE_URL}/auth/token`);
        
        ACCESS_TOKEN = await authorize({
            clientId  : CLIENT_ID,
            privateKey: KEY.toPEM(true),
            tokenUrl  : `${BASE_URL}/auth/token`
        });

        // console.log("BASE_URL: %o\nCLIENT_ID: %o\nACCESS_TOKEN: %o" , BASE_URL, CLIENT_ID, ACCESS_TOKEN)
    });

    // TODO: Clear mocks after each test?
    afterEach(async () => {
        await rootReq;
        nock.cleanAll()
    })
    
    it("Can start dynamic import", async function() {

        this.timeout(50000)

        const BulkDataServer = nock(BulkDataServerHost);

        BulkDataServer.post("/$export").reply(202, (uri) => {
            console.log("Requested ", uri)
            return ""
        }, { "content-location": `${BulkDataServerHost}/status` });
        
        BulkDataServer.get("/status").reply(200, (uri) => {
            console.log("Requested ", uri)
            return {
                "transactionTime": "[instant]",
                "request" : "http://www.example.com/$export",
                "requiresAccessToken" : false,
                "output" : [{
                  "type" : "Patient",
                  "url" : `${BulkDataServerHost}/download/file_1.ndjson`
                }],
                "error" : []
            }
        })

        BulkDataServer.get("/download/:file").reply(200, (uri) => {
            console.log("Requested ", uri)
            return '{resourceType:"Patient"}\n{resourceType:"Patient"}'
        })

        const statusUrl = await AGENT
            .post("/$import")
            .type("json")
            .set("authorization", `bearer ${ACCESS_TOKEN}`)
            .send({
                resourceType: "Parameters",
                parameter: [
                    {
                        name: "exportUrl",
                        valueUrl: `${BulkDataServerHost}/$export`
                    },
                    {
                        name: "exportType",
                        valueCode: "dynamic"
                    }
                ]
            })
            .expect(202)
            .expect("content-location", new RegExp(`^${BASE_URL}/job/[^/]+$`))
            .then(res => {
                // console.log(res.headers, res.body)
                return res.headers["content-location"]
            });

        await wait(800)

        async function getManifest() {
            let res = await AGENT.get(statusUrl.replace(BASE_URL, ""))
            if (res.status === 202) {
                await wait(100)
                return getManifest();
            }
            return res.body
        }

        const manifest = await getManifest()
        
            // .expect('Content-Type', /json/)
            // .expect(200)
            // .expect({
            //     "transactionTime": "[instant]",
            //     "request" : "http://www.example.com/$export",
            //     "requiresAccessToken" : false,
            //     "output" : [{
            //       "type" : "Patient",
            //       "url" : `${BulkDataServerHost}/download/file_1.ndjson`
            //     }],
            //     "error" : []
            // })
            .then(res => {
                console.log(
                    res.statusCode,
                    res.headers,
                    res.body
                );
            })
    })

})