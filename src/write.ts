import { type Font, loadSync } from 'opentype.js';
import { type CanvasRenderingContext2D, GlobalFonts, createCanvas } from '@napi-rs/canvas';
import { basename, dirname, join } from 'node:path';

export const fontCache: FontMap = new Map();
export const registeredFonts = new Set<string>();
const shared: string[] = [];

export const getFontAlias = (fontPath: string, alias: Record<string, string>) => {
    const fontName = basename(dirname(fontPath));
    const fontWeight = fontPath.split('-')[1]?.replace('.ttf', '');

    return `${alias[fontName]}-${fontWeight}`;
}

const alias: Record<string, string> = {
    "Oswald": "Owsald",
    "NotoSansJP": "Noto Sans JP",
    "NotoSansKR": "Noto Sans KR",
    "NotoSansTC": "Noto Sans TC",
    "NotoSansSC": "Noto Sans SC",
    "NotoSansBengali": "Noto Sans Bengali",
    "NotoSans": "Noto Sans"
}

function safeRegisterFont(fontPath: string) {
    if (!registeredFonts.has(fontPath)) {
        const fontAlias = getFontAlias(fontPath, alias);

        GlobalFonts.registerFromPath(fontPath, fontAlias);
        registeredFonts.add(fontPath);
        shared.push(fontPath);
    }
}

/**
 * Registers custom fonts from specified paths and aliases.
 * 
 * Each font file must follow the naming pattern: `Family-Weight.ttf`, e.g., `MyFont-Bold.ttf`.
 * You must provide an alias for each family used, e.g., `'MyFont': 'My Font'`.
 * 
 * @param {string[]} fontPaths - Full paths to font files.
 * @param {Record<string, string>} aliases - Maps folder (family) name to display name.
 */
export function registerCustomFonts(fontPaths: string[], aliases: Record<string, string>) {
    for (const fontPath of fontPaths) {
        const familyDir = basename(dirname(fontPath));
        const fullAlias = getFontAlias(fontPath, aliases);

        if (!fullAlias) {
            console.warn(`[FontRegister]: No alias provided for family: ${familyDir}`);
            continue;
        }

        safeRegisterFont(fontPath);
    }
}

/**
 * Return the opentype.js Font interface for the font path, using a cahe.
 */
function getOrLoadFont(fontPath: string): Font {
    let font = fontCache.get(fontPath);
    if (!font) {
        font = loadSync(fontPath);
        fontCache.set(fontPath, font);
    }

    return font;
}

export function fontPaths(weight: FontWeight): string[] {
    const defaultFonts = [
        "Oswald",
        "NotoSansJP",
        "NotoSansKR",
        "NotoSans",
    ].map(family =>
        new URL(`./assets/fonts/${family}/${family}-${weight}.ttf`, import.meta.url).pathname
    );

    return [...defaultFonts, ...shared.filter(p => p.includes(`-${weight}.ttf`))];
}

/**
 * Checks if a specified glyph exists in the given font.
 * @param {Font} font The font to check the glyph in.
 * @param {string} glyph The glyph to check for.
 * @returns {boolean} True if the glyph exists in the font, false otherwise.
 */
export function checkGlyph(font: Font, glyph: string): boolean {
    try {
        return font.charToGlyph(glyph).index !== 0;
    } catch { return false; }
}

/**
 * Groups consecutive characters in a string based on the font required to render them.
 * @param {string} text The text to be grouped by font.
 * @param {string[]} fontPaths A map mapping font paths to font objects.
 */
export function groupByFont(text: string, fontPaths: string[]): FontGroup[] {
    const groups: FontGroup[] = [];
    const commonChars = ` ,!@#$%^&*(){}[]+_=-""''?`;

    if (fontPaths.length === 0 || !text) return [];

    let lastFontPath = fontPaths[0]!;
    for (const char of text) {
        if (commonChars.includes(char)) {
            groups.push([char, lastFontPath]);
            continue;
        }

        let charMatched = false;
        for (const fontPath of fontPaths) {
            const font = getOrLoadFont(fontPath);
            if (checkGlyph(font, char)) {
                lastFontPath = fontPath;
                groups.push([char, fontPath]);
                charMatched = true;
                break;
            }
        }

        if (!charMatched) {
            groups.push([char, lastFontPath]);
        }
    }

    // Merge consecutive groups with same font path
    const merged: FontGroup[] = groups.length ? [groups[0]!] : [];
    for (const [char, fontPath] of groups.slice(1)) {
        const last = merged.at(-1);
        if (last && last[1] === fontPath) {
            last[0] += char;
        } else {
            merged.push([char, fontPath]);
        }
    }

    return merged;
}

/**
 * Utility to clear font caches (for debugging or memory management).
 */
export function clearFontCache() {
    fontCache.clear();
    registeredFonts.clear();
}

/**
 * Renders a single line of text on the image with specified styling.
 * @param {CanvasRenderingContext2D} ctx The canvas rendering context.
 * @param {[x: number, y: number]} pos The position of the text.
 * @param {string} text The text to be rendered.
 * @param {RGB} color The text color in RGB format.
 * @param {string[]} fontPaths An array of font paths.
 * @param {number} size The font size.
 * @param {Align} align The text alignment.
 */
export function renderSingleLine(
    ctx: CanvasRenderingContext2D,
    pos: Readonly<[x: number, y: number]>,
    text: string,
    color: RGB,
    fontPaths: string[],
    size: number,
    align: Align = 'left',
    anchor?: Anchor
) {
    if (!text) return;

    const [x, y] = pos;
    const formatted = groupByFont(text, fontPaths);

    const usedFontPaths = new Set<string>();

    // Set anchor as baseline & alignment
    switch (anchor) {
        case "lt": ctx.textAlign = "left"; ctx.textBaseline = "top"; break;
        case "lb": ctx.textAlign = "left"; ctx.textBaseline = "bottom"; break;
        case "mm": ctx.textAlign = "center"; ctx.textBaseline = "middle"; break;
        case "rt": ctx.textAlign = "right"; ctx.textBaseline = "top"; break;
        case "rb": ctx.textAlign = "right"; ctx.textBaseline = "bottom"; break;
    }

    ctx.fillStyle = `rgb(${color.join(',')})`;

    // Measure total width for alignment offset
    let totalWidth = 0;
    for (const [txt, fontPath] of formatted) {
        if (!usedFontPaths.has(fontPath)) {
            safeRegisterFont(fontPath);
            usedFontPaths.add(fontPath);
        }

        ctx.font = `${size}px "${getFontAlias(fontPath, alias)}"`;
        totalWidth += ctx.measureText(txt).width;
    }

    let startX = x;
    if (align === "center") startX = x - totalWidth / 2;
    else if (align === "right") startX = x - totalWidth;

    // Render each part
    let offsetX = 0;
    for (const [char, fontPath] of formatted) {
        
        ctx.font = `${size}px "${getFontAlias(fontPath, alias)}"`;

        const width = ctx.measureText(char).width;
        ctx.fillText(char, startX + offsetX, y);
        offsetX += width;
    }
}

/**
 * Returns the width of the text without drawing it.
 * 
 * @param {string} text The text to measure
 * @param {string[]} fontPaths An array of font paths to use
 * @param {number} size The font size
 * @returns {number} The width of the text
 *}
 */
export function textWidth(
    text: string,
    fontPaths: string[],
    size: number
): number {
    if (!text) return 0;

    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    let totalWidth = 0;
    const formatted = groupByFont(text, fontPaths);

    const usedFontPaths = new Set<string>();
    for (const [fragment, fontPath] of formatted) {
        if (!usedFontPaths.has(fontPath)) {
            safeRegisterFont(fontPath);
            usedFontPaths.add(fontPath);
        }

        ctx.font = `${size}px "${getFontAlias(fontPath, alias)}"`;

        const metrics = ctx.measureText(fragment);
        const width = metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft;

        totalWidth += isNaN(width) || width <= 0 ? metrics.width : width;
    }

    return Math.round(totalWidth);
}

/**
 * Renders text on an image at a specified position with customizable font, size, color, alignment, spacing and anchor.
 * @param {CanvasRenderingContext2D} ctx The canvas context.
 * @param pos The position of the text.
 * @param text The text to render.
 * @param color The text color in RGB format.
 * @param fonts A map of fonts to use.
 * @param size The font size.
 * @param align Text alignment (left, center, right).
 * @param spacing Vertical spacing between lines.
 * @param anchor Text anchor of alignment.
 */
export function text(
    ctx: CanvasRenderingContext2D,
    pos: Readonly<[x: number, y: number]>,
    text: string,
    color: RGB,
    fontPaths: string[],
    size: number,
    align: Align = 'left',
    spacing: number = 0,
    anchor: Anchor = 'lt'
): void {
    if (!text) return;

    const [x, y] = pos;

    // Choose multiline function if text has line breaks.
    if (text.includes('\n')) {
        let y_offset = 0;
        const lines = text.split('\n');
        const scale = Math.floor(Number(((size * 6) / 42).toFixed(1)))

        for (const line of lines) {
            renderSingleLine(
                ctx,
                [x, y + y_offset],
                line,
                color,
                fontPaths,
                size,
                align,
                anchor
            );
            y_offset += size + scale + spacing;
        }
    } else {
        renderSingleLine(
            ctx,
            pos,
            text,
            color,
            fontPaths,
            size,
            align,
            anchor
        );
    }
}

/**
 * Draws a heading within a specified width limit on an image.
 * @param {CanvasRenderingContext2D} ctx The canvas rendering context.
 * @param {[x: number, y: number]} pos The position of the text.
 * @param {number} maxWidth The maximum width allowed for the heading.
 * @param {string} text The text to render.
 * @param {RGB} color The text color in RGB format.
 * @param {FontMap} fontPaths An array of font paths to use.
 * @param {number} initialSize The font size.
 */
export function heading(
    ctx: CanvasRenderingContext2D,
    pos: Readonly<[x: number, y: number]>,
    maxWidth: number,
    text: string,
    color: RGB,
    fontPaths: string[],
    initialSize: number
) {
    if (!text) return;

    let size = initialSize;
    let totalWidth = Infinity;

    // Pair words with corresponding fonts.
    const wordsFonts = groupByFont(text, fontPaths);

    // Register all needed fonts once per heading render
    const usedFontPaths = new Set<string>();

    // Adjust font size to fit within max_width
    while (totalWidth > maxWidth && size > 1) {
        totalWidth = 0;
        for (const [word, fontPath] of wordsFonts) {
            if (!usedFontPaths.has(fontPath)) {
                safeRegisterFont(fontPath);
                usedFontPaths.add(fontPath);
            }

            ctx.font = `${size}px "${getFontAlias(fontPath, alias)}"`;
            totalWidth += ctx.measureText(word).width;
        }
        if (totalWidth > maxWidth) size--;
    }

    // Render each word with its corresponding font.
    let offset = 0;
    ctx.fillStyle = `rgb(${color.join(',')})`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    for (const [word, fontPath] of wordsFonts) {
        // Font already registered above
        
        ctx.font = `${size}px "${getFontAlias(fontPath, alias)}"`;
        ctx.fillText(word, pos[0] + offset, pos[1]);

        offset += ctx.measureText(word).width;
    }
}

export type FontWeight = 'Regular' | 'Bold' | 'Light';
export type Align = 'left' | 'center' | 'right';
export type Anchor = 'lt' | 'mm' | 'rb' | 'lb' | 'rt';
export type RGB = [r: number, g: number, b: number];
export type FontMap = Map<string, Font>;
export type FontGroup = [string, string];