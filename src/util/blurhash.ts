const DIGIT_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

const CHAR_LOOKUP: Record<string, number> = DIGIT_CHARACTERS.split("").reduce((accumulator, character, index) => {
        accumulator[character] = index;
        return accumulator;
}, {} as Record<string, number>);

function decode83(value: string): number {
        let result = 0;
        for(let index = 0; index < value.length; index++) {
                const character = value[index];
                const digit = CHAR_LOOKUP[character];
                if(digit === undefined) throw new Error(`Invalid blurhash character: ${character}`);
                result = result * 83 + digit;
        }
        return result;
}

function sRGBToLinear(value: number): number {
        const normalized = value / 255;
        if(normalized <= 0.04045) return normalized / 12.92;
        return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearToSRGB(value: number): number {
        const clamped = Math.max(0, Math.min(1, value));
        if(clamped <= 0.0031308) return Math.round(clamped * 12.92 * 255 + 0.5);
        return Math.round((1.055 * Math.pow(clamped, 1 / 2.4) - 0.055) * 255 + 0.5);
}

function signPow(value: number, exponent: number): number {
        return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

function decodeDC(value: number): [number, number, number] {
        const r = value >> 16;
        const g = (value >> 8) & 255;
        const b = value & 255;
        return [sRGBToLinear(r), sRGBToLinear(g), sRGBToLinear(b)];
}

function decodeAC(value: number, maximumValue: number): [number, number, number] {
        const quantR = Math.floor(value / (19 * 19));
        const quantG = Math.floor(value / 19) % 19;
        const quantB = value % 19;

        return [
                signPow((quantR - 9) / 9, 2) * maximumValue,
                signPow((quantG - 9) / 9, 2) * maximumValue,
                signPow((quantB - 9) / 9, 2) * maximumValue
        ];
}

export function decodeBlurhash(blurhash: string, width: number, height: number, punch: number = 1): Uint8ClampedArray {
        if(!blurhash || blurhash.length < 6) {
                throw new Error("Blurhash string is too short.");
        }

        const sizeFlag = decode83(blurhash.substring(0, 1));
        const numY = Math.floor(sizeFlag / 9) + 1;
        const numX = (sizeFlag % 9) + 1;

        const expectedLength = 4 + 2 * numX * numY;
        if(blurhash.length !== expectedLength) {
                throw new Error("Blurhash length mismatch.");
        }

        const quantizedMaximumValue = decode83(blurhash.substring(1, 2));
        const maximumValue = (quantizedMaximumValue + 1) / 166;

        const colors: Array<[number, number, number]> = [];
        colors.push(decodeDC(decode83(blurhash.substring(2, 6))));

        let position = 6;
        while(position < blurhash.length) {
                const value = decode83(blurhash.substring(position, position + 2));
                position += 2;
                colors.push(decodeAC(value, maximumValue * punch));
        }

        const pixels = new Uint8ClampedArray(width * height * 4);
        let pixelIndex = 0;
        for(let y = 0; y < height; y++) {
                for(let x = 0; x < width; x++) {
                        let r = 0;
                        let g = 0;
                        let b = 0;

                        for(let j = 0; j < numY; j++) {
                                for(let i = 0; i < numX; i++) {
                                        const basis = Math.cos((Math.PI * x * i) / width) * Math.cos((Math.PI * y * j) / height);
                                        const color = colors[i + j * numX];
                                        r += color[0] * basis;
                                        g += color[1] * basis;
                                        b += color[2] * basis;
                                }
                        }

                        pixels[pixelIndex++] = linearToSRGB(r);
                        pixels[pixelIndex++] = linearToSRGB(g);
                        pixels[pixelIndex++] = linearToSRGB(b);
                        pixels[pixelIndex++] = 255;
                }
        }

        return pixels;
}

export function blurhashToDataURL(
        blurhash: string,
        width: number = 32,
        height: number = 32,
        punch: number = 1
): string | undefined {
        try {
                if(typeof document === "undefined") return undefined;
                const pixels = decodeBlurhash(blurhash, width, height, punch);
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d");
                if(!context) return undefined;
                const imageData = context.createImageData(width, height);
                imageData.data.set(pixels);
                context.putImageData(imageData, 0, 0);
                return canvas.toDataURL();
        } catch(error) {
                console.warn("Failed to decode blurhash", error);
                return undefined;
        }
}
