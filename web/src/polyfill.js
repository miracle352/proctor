// Some wallet code expects Node's Buffer.
import { Buffer } from "buffer";
globalThis.Buffer ||= Buffer;
