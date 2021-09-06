import { Transform } from "stream"


/**
 * Passes FHIR resources through if they have a "resourceType" and "id"
 * properties. Throws otherwise.
 */
export default class ValidateFHIR extends Transform
{
    private _resourceNumber = 1;

    constructor()
    {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });
    }

    _transform(resource: fhir4.Resource, encoding: any, next: (err?: Error) => any)
    {
        const resourceType = resource.resourceType;

        if (!resourceType) {
            return next(new Error(
                `No resourceType found for resource number ${this._resourceNumber}.`
            ));
        }

        if (!resource.id && resourceType !== "Bundle") {
            return next(new Error(
                `No "id" found for resource number ${this._resourceNumber}.`
            ));
        }

        this.push(resource);
        this._resourceNumber++;
        next();
    }
}

