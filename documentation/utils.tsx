import mappings from "../configurator/frontend/src/catalog/mappings/lib";
import {Mapping} from "../configurator/frontend/src/catalog/mappings/types";

export function generateMapping(type: string, indent: string) {
    let mapping: Mapping = mappings[type];
    if (!mapping) {
        throw new Error('mapping === null');
    }
    return mapping.mappings.map(m => `- src: ${m.src}\n  dst: ${m.dst}\n  action: ${m.action}`).join("\n")
        .split("\n").map(line => `${indent}${line}`).join("\n")
}