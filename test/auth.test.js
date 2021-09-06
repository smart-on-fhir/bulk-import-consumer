const request = require("supertest");
const app     = require("../build/index");

// describe("AUTH", () => {
    
//     describe("/auth/register", () => {

//         it.skip("Requires JSON POST")
//         it.skip("Requires jwks or jwks_uri")
//         it.skip("Requires consumer_client_id")
//         it.skip("Requires aud")
        
//         it("Works as expected", async () => {
//             return request(app)
//             .post("/auth/register")
//             .type("json")
//             .send({
//                 jwks_uri: "https://whatever.dev/jwks",
//                 consumer_client_id: "test-consumer-client-id",
//                 aud: "https://whatever.dev/aud"
//             })
//             .expect('Content-Type', /json/)
//             .expect(200)
//             .expect(/"client_id":".+?\..+?\..+?"/);
//         })
//     });

//     describe("/auth/token", () => {
//         it.skip("Requires client_assertion_type parameter")
//         it.skip("Validates client_assertion_type")
//         it.skip("Requires client_assertion parameter")
//         it.skip("Validates client_assertion")
//         it.skip("Works as expected")
//     });

// })