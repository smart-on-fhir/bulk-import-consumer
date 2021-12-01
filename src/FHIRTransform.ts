import { Transform }      from "stream"
import * as pdfJsLib      from "pdfjs-dist/legacy/build/pdf"
import config             from "./config"
import { BulkDataClient } from "./BulkDataClient";

class PDF {

    public static async getPageText(pdf: any, pageNo: number) {
        const page = await pdf.getPage(pageNo);
        const tokenizedText = await page.getTextContent();
        return tokenizedText.items.map((token: any) => token.str).join('');
    }
  
    public static async getPDFText(source: any): Promise<string> {
        const pdf = await pdfJsLib.getDocument(source).promise;
        const maxPages = pdf.numPages;
        const pageTextPromises = [];
        for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
            pageTextPromises.push(PDF.getPageText(pdf, pageNo));
        }
        const pageTexts = await Promise.all(pageTextPromises);
        return pageTexts.join(' ');
    }
}


async function downloadAttachment(url: string, client: BulkDataClient) {
    if (url.search(/^https?:\/\/.+/) === 0) {
        return downloadAttachmentFromAbsoluteUrl(url, client)
    }
    return downloadAttachmentFromRelativeUrl(url, client);
}

async function downloadAttachmentFromAbsoluteUrl(url: string, client: BulkDataClient) {
    console.log(`Downloading attachment from ${url}`)
    return await client.request(url, {
        responseType: "buffer",
        resolveBodyOnly: true,
        headers: {
            authorization: `Bearer ${ await client.getAccessToken() }`
        }
    });
}

async function downloadAttachmentFromRelativeUrl(url: string, client: BulkDataClient) {
    console.log(`Downloading attachment from ${url}`)
    return await client.request(url, {
        responseType: "buffer",
        resolveBodyOnly: true,
        headers: {
            authorization: `Bearer ${ await client.getAccessToken() }`
        }
    });
}

async function inlineAttachmentData(node: fhir4.Attachment, data: Buffer) {
    if (node.contentType == "application/pdf") {
        data = await pdfToText(data);
    }
    node.size = data.byteLength
    node.data = data.toString("base64")
    delete node.url
    return node
}

async function pdfToText(data: Buffer) {
    const text = await PDF.getPDFText({ data });
    return Buffer.from(text);
}

async function handleAttachmentReference(res: fhir4.DocumentReference, client: BulkDataClient): Promise<fhir4.DocumentReference> {

    for (const entry of res.content || []) {
        const attachment = entry.attachment;
        
        if (!attachment.url) {
            continue;
        }

        const data = await downloadAttachment(attachment.url, client);
        await inlineAttachmentData(attachment, data);
    }

    return res;
}


/**
 * Consumes FHIR resources and applies custom transformations to them.
 */
export default class FHIRTransform extends Transform
{
    private _resourceNumber = 1;

    private client: BulkDataClient

    constructor({ client }: { client: BulkDataClient })
    {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this.client = client
    }

    override _transform(resource: fhir4.Resource, encoding: any, next: (err?: Error) => any)
    {
        // Special handling is needed for DocumentReference resources
        if (resource.resourceType === "DocumentReference" && config.inlineAttachments) {

            return handleAttachmentReference(resource as fhir4.DocumentReference, this.client)
                .then(res => {
                    this.push(res);
                    this._resourceNumber++;
                })
                .catch(err => {
                    next(new Error(
                        `Error handling resource ${this._resourceNumber}: ${err}`
                    ));
                });
        }

        // Pass unmodified resources through
        this.push(resource);
        this._resourceNumber++;
        next();
    }
}

