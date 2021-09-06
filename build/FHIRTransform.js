"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const stream_1 = require("stream");
const pdfJsLib = __importStar(require("pdfjs-dist"));
const config_1 = __importDefault(require("./config"));
const request_1 = __importDefault(require("./request"));
class PDF {
    static async getPageText(pdf, pageNo) {
        const page = await pdf.getPage(pageNo);
        const tokenizedText = await page.getTextContent();
        return tokenizedText.items.map((token) => token.str).join('');
    }
    static async getPDFText(source) {
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
async function downloadAttachment(url) {
    if (url.search(/^https?:\/\/.+/) === 0) {
        return downloadAttachmentFromAbsoluteUrl(url);
    }
    return downloadAttachmentFromRelativeUrl(url);
}
async function downloadAttachmentFromAbsoluteUrl(url) {
    console.log(`Downloading attachment from ${url}`);
    return await request_1.default(url, {
        responseType: "buffer",
        resolveBodyOnly: true
    });
}
async function downloadAttachmentFromRelativeUrl(url) {
    console.log(`Downloading attachment from ${url}`);
    return await request_1.default(url, {
        responseType: "buffer",
        resolveBodyOnly: true
    });
}
async function inlineAttachmentData(node, data) {
    if (node.contentType == "application/pdf") {
        data = await pdfToText(data);
    }
    node.size = data.byteLength;
    node.data = data.toString("base64");
    delete node.url;
    return node;
}
async function pdfToText(data) {
    const text = await PDF.getPDFText({ data });
    return Buffer.from(text);
}
async function handleAttachmentReference(res) {
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
class FHIRTransform extends stream_1.Transform {
    constructor() {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });
        this._resourceNumber = 1;
    }
    _transform(resource, encoding, next) {
        // Special handling is needed for DocumentReference resources
        if (resource.resourceType === "DocumentReference" && config_1.default.inlineAttachments) {
            return handleAttachmentReference(resource)
                .then(res => {
                this.push(res);
                this._resourceNumber++;
            })
                .catch(err => {
                next(new Error(`Error handling resource ${this._resourceNumber}: ${err}`));
            });
        }
        // Pass unmodified resources through
        this.push(resource);
        this._resourceNumber++;
        next();
    }
}
exports.default = FHIRTransform;
