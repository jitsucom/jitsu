export const cryptoCode = `const randomUUID = (options)  => {
    return  _jitsu_crypto.getSync("randomUUID", {accessors: true, reference: true}).applySync(undefined, [options], {
        arguments: { copy: true },
        result: { copy: true }
    });
}

const randomBytes = (size)  => {
    return  _jitsu_crypto.getSync("randomBytes", {accessors: true, reference: true}).applySync(undefined, [size], {
        arguments: { copy: true },
        result: { copy: true }
    });
}

const randomInt = (min, max)  => {
    return  _jitsu_crypto.getSync("randomInt", {accessors: true, reference: true}).applySync(undefined, [min, max], {
        arguments: { copy: true },
        result: { copy: true }
    });
}

const hash = (algorithm, input , encoding)  => {
    return  _jitsu_crypto.getSync("hash", {accessors: true, reference: true}).applySync(undefined, [algorithm, input, encoding], {
        arguments: { copy: true },
        result: { copy: true }
    });
}

export {hash, randomUUID, randomBytes, randomInt };
`;
