'use strict';

const sharp = require('sharp');

const DEFAULT_THRESHOLDS = { horizontal: 3.5, vertical: 5.0 }; // mm
const WHITE_THRESHOLD = 240; // pixel brightness below this = "content"
const SHARP_PIXEL_LIMIT = 268402689 * 4; // 4x default limit for large images

// A5 page dimensions in mm
const A5_WIDTH_MM = 148.0;
const A5_HEIGHT_MM = 210.0;

/**
 * Analyzes an image buffer to determine if content reaches the page edges.
 * Uses pixel-level edge strip analysis to detect borderless content.
 *
 * @param {Buffer} imageBuffer - PNG image buffer (already rotated/processed)
 * @param {Object} [thresholds] - Minimum margin thresholds in mm
 * @param {number} [thresholds.horizontal=3.5] - Horizontal margin (left/right) in mm
 * @param {number} [thresholds.vertical=5.0] - Vertical margin (top/bottom) in mm
 * @returns {Promise<{needsMargin: boolean, scaleFactor: number}>}
 */
async function analyzeMargins(imageBuffer, thresholds = DEFAULT_THRESHOLDS) {
    const { data, info } = await sharp(imageBuffer, {
        limitInputPixels: SHARP_PIXEL_LIMIT
    }).grayscale().raw().toBuffer({ resolveWithObject: true });

    const { width, height } = info;

    // Convert mm thresholds to pixels using image dimensions relative to A5 size
    // Simplified: marginPx = thresholdMm * imagePx / pageSizeMm
    const marginHPx = Math.max(1, Math.round(thresholds.horizontal * width / A5_WIDTH_MM));
    const marginVPx = Math.max(1, Math.round(thresholds.vertical * height / A5_HEIGHT_MM));

    const hasContent = checkEdgeStrips(data, width, height, marginHPx, marginVPx);

    if (!hasContent) {
        return { needsMargin: false, scaleFactor: 1.0 };
    }

    // Calculate scale factor to enforce margins
    const scaleH = (A5_WIDTH_MM - 2 * thresholds.horizontal) / A5_WIDTH_MM;
    const scaleV = (A5_HEIGHT_MM - 2 * thresholds.vertical) / A5_HEIGHT_MM;
    const scaleFactor = Math.max(0.5, Math.min(scaleH, scaleV));

    return { needsMargin: true, scaleFactor };
}

/**
 * Checks if any non-white pixels exist within the edge strips of a grayscale image.
 * @param {Buffer} data - Raw grayscale pixel data (1 channel per pixel)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {number} marginH - Horizontal margin in pixels
 * @param {number} marginV - Vertical margin in pixels
 * @returns {boolean} True if content detected at edges
 */
function checkEdgeStrips(data, w, h, marginH, marginV) {
    const clampedMarginH = Math.min(marginH, w);
    const clampedMarginV = Math.min(marginV, h);

    // Left strip
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < clampedMarginH; x++) {
            if (data[y * w + x] < WHITE_THRESHOLD) return true;
        }
    }
    // Right strip
    for (let y = 0; y < h; y++) {
        for (let x = w - clampedMarginH; x < w; x++) {
            if (data[y * w + x] < WHITE_THRESHOLD) return true;
        }
    }
    // Top strip
    for (let y = 0; y < clampedMarginV; y++) {
        for (let x = 0; x < w; x++) {
            if (data[y * w + x] < WHITE_THRESHOLD) return true;
        }
    }
    // Bottom strip
    for (let y = h - clampedMarginV; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (data[y * w + x] < WHITE_THRESHOLD) return true;
        }
    }
    return false;
}

module.exports = { analyzeMargins };
