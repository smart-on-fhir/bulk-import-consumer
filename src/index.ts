import express, { Request, Response }        from "express"
import cors                                  from "cors"
import { RequestError, HTTPError }           from "got"
import { OperationOutcome }                  from "./OperationOutcome"
import { CustomError }                       from "./CustomError"
import { routeHandler }                      from "./lib"
import { tokenHandler, registrationHandler } from "./auth"
import generator                             from "./generator"
import { OAuthError }                        from "./OAuthError"
import config                                from "./config"
import { ImportJob }                         from "./ImportJob"

const app = express();

app.use(cors({ origin: true, credentials: true }));

app.post("/\\$import", express.json({ type: config.jsonContentTypes }), routeHandler(ImportJob.kickOff))

app.get("/job/:id/import-outcome.ndjson", routeHandler(ImportJob.importOutcome))
    
app.get("/job/:id", routeHandler(ImportJob.status))

app.delete("/job/:id", routeHandler(ImportJob.cancel))

app.post("/auth/token", express.urlencoded({ extended: false }), routeHandler(tokenHandler));

app.post("/auth/register", express.json(), routeHandler(registrationHandler));

app.get("/generator", generator);

app.use(express.static("frontend"));

app.use((error: Error, req: Request, res: Response, next: any) => {
    console.error(error)

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
            res.status(error.status).json(
                new OperationOutcome(error.message, error.status, error.severity).toJSON()
            )
        } else {
            res.status(500).json(
                new OperationOutcome("Internal Server Error", 500, "fatal").toJSON()
            )
        }
    } else {
        if (error instanceof CustomError) {
            res.status(error.status).json(error)
        } else {
            res.status(500).end('Internal Server Error')
        }
    }
})

const server = app.listen(config.port, config.host, () => {
    let addr = server.address();
    if (addr && typeof addr != "string") {
        const { address, port } = addr;
        addr = `http://${address}:${port}`;
    }
    console.log(`Server listening on ${addr}`);
})
