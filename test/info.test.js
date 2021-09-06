const request    = require("supertest");
const { expect } = require("chai")
const app        = require("../build/index");


it ("Provides metadata at /info", async () => {
    return request(app).get("/info")
    .expect('Content-Type', /json/)
    .expect(200)
    .expect(({ body }) => {
        expect(body).to.be.an("array");
        [
            "Server URL",
            "Import Kick-off URL",
            "Token Endpoint",
            "JWKS URL",
            "Public Key",
            "Import File Behavior"
        ].forEach(label => {
            expect(body.find(x => x.label === label), `The ${label} is not included in the info metadata`).to.exist;
        });    
    })
});
