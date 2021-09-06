const stream = require("stream");
const uuid = require("uuid");
const path = require("path");
/**
 * This is a transform stream that will do the following:
 * 1. Validate incoming object and verify that they have `resourceType` and `id`
 * 2. If resources are not "DocumentReference" pass them through
 * 3. If resources are "DocumentReference" having `content[0].attachment.url`:
 *    - Schedule another download for that url
 *    - Save the file under unique name to avoid duplicate conflicts
 *    - Modify content[0].attachment.url to use the downloaded file path
 */
class DocumentReferenceHandler extends stream.Transform {
    constructor(options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });
        this.options = options;
        this.num = 1;
    }
    _transform(resource, encoding, callback) {
        const resourceType = resource.resourceType;
        if (!resourceType) {
            return callback(new Error(`No resourceType found for resource number ${this.num}.`));
        }
        if (!resource.id && resourceType !== "Bundle") {
            return callback(new Error(`No "id" found for resource number ${this.num}.`));
        }
        const next = () => {
            this.push((this.num > 1 ? "\n" : "") + JSON.stringify(resource));
            this.num++;
            callback();
        };
        if (resourceType == "DocumentReference") {
            const url = String(resource.content?.[0]?.attachment?.url || "");
            if (url.search(/^https?:\/\/.+/) === 0) {
                const asUrl = new URL(url);
                const displayName = path.basename(asUrl.pathname);
                const ext = path.extname(asUrl.pathname);
                const fileName = uuid.v5(url, uuid.v5.URL) + ext;
                resource.content[0].attachment.url = "file://" + path.join(__dirname, "../downloads/attachments/", fileName);
                this.options.onAttachment(url, fileName, displayName);
                next();
            }
            else {
                next();
            }
        }
        else {
            next();
        }
    }
}
module.exports = DocumentReferenceHandler;
