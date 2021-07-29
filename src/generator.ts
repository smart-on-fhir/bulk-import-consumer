import { Request, Response } from "express"
import { JWK } from "node-jose"

const config = {
    "RS256": { kty: "RSA", size: 2048    },
    "RS384": { kty: "RSA", size: 2048    },
    "RS512": { kty: "RSA", size: 2048    },
    "ES256": { kty: "EC" , size: "P-256" },
    "ES384": { kty: "EC" , size: "P-384" },
    "ES512": { kty: "EC" , size: "P-521" }
}

export default async function(req: Request, res: Response) {
    let alg = String(req.query.alg || "").toUpperCase();

    if (!config.hasOwnProperty(alg)) {
        alg = "RS384";
    }

    const store = JWK.createKeyStore();
    const settings = config[alg as keyof typeof config];
    
    const key = await store.generate(settings.kty, settings.size, { alg });

    res.json({
        jwks        : store.toJSON(true),
        publicAsJWK : key.toJSON(false),
        publicAsPEM : key.toPEM(false),
        privateAsJWK: key.toJSON(true),
        privateAsPEM: key.toPEM(true)
    });
}
