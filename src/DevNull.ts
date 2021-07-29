import { Writable } from "stream"


export class DevNull extends Writable
{
    constructor()
    {
        super({ objectMode: true });
    }

    _write(chunk: any, encoding: any, callback: any)
    {
        callback();
    }
}
