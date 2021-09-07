import { resolve }                              from "path"
import express, { Request, Response }           from "express"
import cors                                     from "cors"
import util                                     from "util"
import { RequestError, HTTPError, CancelError } from "got"
import { OperationOutcome }                     from "./OperationOutcome"
import { CustomError }                          from "./CustomError"
import { getRequestBaseURL, routeHandler }      from "./lib"
import { tokenHandler, registrationHandler }    from "./auth"
import generator                                from "./generator"
import { OAuthError }                           from "./OAuthError"
import config                                   from "./config"
import { ImportJob }                            from "./ImportJob"
import * as JobManager                          from "./jobManager"

const debug = util.debuglog("app")

const app = express();

app.use(cors({ origin: true, credentials: true }));

app.get("/jwks", (req, res) => res.json({ keys: [ config.publicKey ] }));

app.post("/\\$import", express.json({ type: config.jsonContentTypes }), routeHandler(ImportJob.kickOff))

app.get("/job/:id/import-outcome.ndjson", routeHandler(ImportJob.importOutcome))
    
app.get("/job/:id", routeHandler(ImportJob.status))

app.delete("/job/:id", routeHandler(ImportJob.cancel))

app.post("/auth/token", express.urlencoded({ extended: false }), routeHandler(tokenHandler));

app.post("/auth/register", express.json(), routeHandler(registrationHandler));

app.get("/generator", generator);

app.get("/info", (req: Request, res: Response) => {
    const json = [];
    const origin = getRequestBaseURL(req)
    json.push({
        label: "Server URL",
        value: origin,
        description: "The server you are using is currently hosted at this URL"
    })

    json.push({
        label: "Import Kick-off URL",
        value: `${origin}/$import`,
        description: "Data Providers can send ping requests to this URL to trigger imports"
    })

    json.push({
        label: "Registration Endpoint",
        value: `${origin}/auth/register`,
        description: "POST requests can be sent to this URL to register new clients dynamically"
    })

    json.push({
        label: "Token Endpoint",
        value: `${origin}/auth/token`,
        description: "Registered clients should send authentication requests to this URL"
    })

    json.push({
        label: "JWKS URL",
        value: `${origin}/jwks`,
        description: "The public key of this server is available at this URL"
    })

    json.push({
        label: "Public Key",
        value: config.publicKey,
        description: "Use this when you want to register this server as client of a data provider which does not support JWKS URL authentication"
    })

    switch(config.destination.type) {
        case "dev-null":
            json.push({
                label: "Import File Behavior",
                value: "none",
                description: "Imported files are discarded immediately (this is just a test server)"
            })
        break;
        case "tmp-fs":
            json.push({
                label: "Import File Behavior",
                value: "temporary filesystem storage",
                description: `Imported files are stored at ${resolve(__dirname, "../jobs")}/{job_id} for ${config.jobsMaxAge} minutes`
            })
        break;
        case "s3":
            json.push({
                label: "Import File Behavior",
                value: "Amazon S3 Bucket",
                description: `Imported files are uploaded to your ${config.destination.options.bucketName} bucket`
            })
        break;
    }

    res.json(json);
})

app.use(express.static("frontend"));

app.use((error: Error, req: Request, res: Response, next: any) => {

    if (error instanceof CancelError) {
        debug("Global Error Handler: %s", error.message)
        return res.status(410).end(error.message)
    }

    if (config.jsonContentTypes.indexOf(req.headers.accept + "") > -1) {
        if (error instanceof RequestError) {
            return res.status(500).json(
                new OperationOutcome(error.message).toJSON()
            )
        }

        if (error instanceof HTTPError) {
            return res.status(500).json(
                new OperationOutcome(error.message).toJSON()
            )
        }

        if (error instanceof OAuthError) {
            return res.status(error.status).json(error.toJSON())
        }

        if (error instanceof CustomError) {
            return res.status(error.status).json(
                new OperationOutcome(error.message, error.status, error.severity).toJSON()
            )
        }

        return res.status(500).json(
            new OperationOutcome("Internal Server Error", 500, "fatal").toJSON()
        )
    }
    
    if (error instanceof CustomError) {
        return res.status(error.status).json(error)
    }
    
    console.log("Global Error Handler: %o", error)
    res.status(500).end('Internal Server Error')
})

JobManager.start();

// Start the server if ran directly (tests import it and start it manually)
/* istanbul ignore if */
if (require.main?.filename === __filename) {
    const server = app.listen(config.port, config.host, () => {
        let addr = server.address();
        if (addr && typeof addr != "string") {
            const { address, port } = addr;
            addr = `http://${address}:${port}`;
        }
        console.log(`Server listening on ${addr}`);
    })
}

export = app;
