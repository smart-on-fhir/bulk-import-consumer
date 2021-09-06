const request    = require("supertest");
const { expect } = require("chai")
const app        = require("../build/index");


describe("Keys generation at /generator", () => {

    const algorithms = [
        "RS256",
        "RS384",
        "RS512",
        "ES256",
        "ES384",
        "ES512",
    ];

    for (const alg of algorithms) {
        it (`Generates ${alg} keys using /generator?alg=${alg}`, async () => {
            return request(app).get(`/generator?alg=${alg}`)
            .expect('Content-Type', /json/)
            .expect(200)
            .expect(res => {
                expect(res.body).to.be.an("object")
                expect(res.body).to.haveOwnProperty("jwks")
                expect(res.body).to.haveOwnProperty("publicAsJWK")
                expect(res.body).to.haveOwnProperty("publicAsPEM")
                expect(res.body).to.haveOwnProperty("privateAsJWK")
                expect(res.body).to.haveOwnProperty("privateAsPEM")
            })
        })
    }

});
