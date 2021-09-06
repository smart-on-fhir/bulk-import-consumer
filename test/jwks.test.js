const request    = require("supertest");
const { expect } = require("chai")
const app        = require("../build/index");
const config     = require("../build/config").default;


it ("Hosts public key(s) at /jwks", async () => {
    return request(app).get("/jwks")
    .expect('Content-Type', /json/)
    .expect(200)
    .expect(res => {
        expect(res.body).to.be.an("object")
        expect(res.body.keys).to.be.an("array")
        expect(res.body.keys).to.deep.include(config.publicKey, "The public key is not included in the JWKS set")
    })
});