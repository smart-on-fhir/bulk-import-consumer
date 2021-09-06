import { Transform } from "stream"
import * as pdfJsLib from "pdfjs-dist"
import config        from "./config"
import request       from "./request"

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


async function downloadAttachment(url: string) {
    if (url.search(/^https?:\/\/.+/) === 0) {
        return downloadAttachmentFromAbsoluteUrl(url)
    }
    return downloadAttachmentFromRelativeUrl(url);
}

async function downloadAttachmentFromAbsoluteUrl(url: string) {
    console.log(`Downloading attachment from ${url}`)
    return await request(url, {
        responseType: "buffer",
        resolveBodyOnly: true
    });
}

async function downloadAttachmentFromRelativeUrl(url: string) {
    console.log(`Downloading attachment from ${url}`)
    return await request(url, {
        responseType: "buffer",
        resolveBodyOnly: true
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

async function handleAttachmentReference(res: fhir4.DocumentReference): Promise<fhir4.DocumentReference> {

    for (const entry of res.content || []) {
        const attachment = entry.attachment;
        
        if (!attachment.url) {
            continue;
        }

        const data = await downloadAttachment(attachment.url);
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

    constructor()
    {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });
    }

    override _transform(resource: fhir4.Resource, encoding: any, next: (err?: Error) => any)
    {
        // Special handling is needed for DocumentReference resources
        if (resource.resourceType === "DocumentReference" && config.inlineAttachments) {

            return handleAttachmentReference(resource as fhir4.DocumentReference)
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

