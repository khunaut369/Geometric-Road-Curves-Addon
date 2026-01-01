// scripts/curve_feedback.js
import { MODES } from './config.js';

export function getCurveFeedback(mode, stats) {
    if (!stats) return "";

    // Common values
    const typeStr = stats.type.replace(/^./, c => c.toUpperCase());
    const rStr = stats.R === Infinity ? "inf" : stats.R.toFixed(2);
    
    // Header
    let msg = `§aCurve generated! Type: ${typeStr}`;

    // Mode C
    if (mode === MODES.MODE_C) {
        return `${msg} // R=${rStr}, L=${stats.L.toFixed(2)}`;
    }

    // Common Params for A/B variants
    msg += ` // R=${rStr}, A=${stats.A.toFixed(2)}°, L=${stats.L.toFixed(2)}`;

    // Height & Slopes
    if (stats.h !== undefined) msg += `, h=${stats.h.toFixed(2)}`;
    if (stats.g1 !== undefined) msg += `, g1=${(stats.g1*100).toFixed(2)}%%`;

    // Special Intermediate Slopes
    if ((mode === MODES.MODE_A1 || mode === MODES.MODE_B1) && stats.gT !== undefined) {
        msg += `, gT=${(stats.gT*100).toFixed(2)}%%`;
    }
    if ((mode === MODES.MODE_A2 || mode === MODES.MODE_B2) && stats.gT1 !== undefined && stats.gT2 !== undefined) {
        msg += `, gT1=${(stats.gT1*100).toFixed(2)}%%, gT2=${(stats.gT2*100).toFixed(2)}%%`;
    }

    // End Slope (Supported for Mode B as well)
    if (stats.g2 !== undefined) msg += `, g2=${(stats.g2*100).toFixed(2)}%%`;

    return msg;
}
