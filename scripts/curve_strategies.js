// scripts/curve_strategies.js
import { MODES } from './config.js'; 
import { 
    Vector3,
    getIntersectionXZ, 
    calculateSimpleCurveFromIntersection,
    calculateSpiralCurveFromIntersection,
    calculateCWTCurveFromIntersection,
    calculateRRRCurveFromIntersection, 
    calculateSimpleCurveFromParallel,
    calculateSpiralCurveFromParallel,
    calculateCWTCurveFromParallel,
    calculateRRRCurveFromParallel,
    calculateCirclePoints,
    calculateS1Height,
    calculateS2RampHeight,
    calculateS3CrossHeight
} from './math_utils.js';

export class CurveStrategies {

    static calculateModeC(vectorRStart, vectorREnd) {
        const result = calculateCirclePoints(vectorRStart, vectorREnd);
        if (result.points.length === 0) return null;

        const dx = vectorREnd.x - vectorRStart.x;
        const dz = vectorREnd.z - vectorRStart.z;
        const R = Math.sqrt(dx*dx + dz*dz);

        return {
            points: result.points,
            cumulativeDist: null, 
            totalLength: result.totalLength,
            stats: { type: 'cir', R: R, L: result.totalLength }
        };
    }

    static calculateModeB(session, type) {
        const S = session.points[0];
        const { refTangent, vectorTSStart, refTangentTS, refSlope, refSlopeTS, targetH, mode } = session;

        // 1. Find Intersection
        const intersection = getIntersectionXZ(S, refTangent, vectorTSStart, refTangentTS);
        
        // 2. Check Angles (Initial heuristic)
        const ang1 = Math.atan2(refTangent.z, refTangent.x);
        const ang2 = Math.atan2(refTangentTS.z, refTangentTS.x);
        let diff = ang2 - ang1;
        while (diff <= -Math.PI) diff += 2 * Math.PI;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        const thetaInit = Math.abs(diff);
        
        let thetaReal = thetaInit;

        // [Reflex Angle Check]
        if (intersection && (type === 'rrr' || type === 'spi' || type === 'cwt')) {
            const vecIntToStart = { x: S.x - intersection.x, z: S.z - intersection.z };
            const dot = vecIntToStart.x * refTangent.x + vecIntToStart.z * refTangent.z;
            if (dot > 0) {
                thetaReal = 2 * Math.PI - thetaInit;
            }
        }

        const thetaDegInit = thetaInit * 180 / Math.PI;
        const thetaDegReal = thetaReal * 180 / Math.PI;

        // [Validation Feedback - English]
        if (!session.isRestoring) {
            if (type === 'spi' && thetaDegReal > 315) {
                session.player.sendMessage(`§c[Warning] Turn angle ${thetaDegReal.toFixed(2)}° exceeds limit (315°) for Spi.`);
            } else if (type === 'cwt' && (thetaDegReal < 14.9 || thetaDegReal > 180.1)) {
                session.player.sendMessage(`§c[Warning] Turn angle ${thetaDegReal.toFixed(2)}° is out of range (14.9°-180.1°) for Cwt.`);
            } else if (type === 'rrr' && thetaDegReal > 180.1) {
                session.player.sendMessage(`§c[Warning] Turn angle ${thetaDegReal.toFixed(2)}° exceeds limit (180.1°) for Rrr.`);
            }
        }

        const useParallelMethod = (!intersection) || (thetaDegInit > 175);
        let horizResult;

        // 3. Calculate Horizontal Geometry
        if (useParallelMethod) {
            if (type === 'rrr') horizResult = calculateRRRCurveFromParallel(S, vectorTSStart, refTangent, refTangentTS, thetaInit);
            else if (type === 'spi') horizResult = calculateSpiralCurveFromParallel(S, vectorTSStart, refTangent, refTangentTS, thetaInit);
            else if (type === 'cwt') horizResult = calculateCWTCurveFromParallel(S, vectorTSStart, refTangent, refTangentTS, thetaInit);
            else horizResult = calculateSimpleCurveFromParallel(S, vectorTSStart, refTangent, refTangentTS, thetaInit);
        } else {
            if (type === 'rrr') horizResult = calculateRRRCurveFromIntersection(S, intersection, refTangent, refTangentTS);
            else if (type === 'spi') horizResult = calculateSpiralCurveFromIntersection(S, intersection, refTangent, refTangentTS);
            else if (type === 'cwt') horizResult = calculateCWTCurveFromIntersection(S, intersection, refTangent, refTangentTS);
            else horizResult = calculateSimpleCurveFromIntersection(S, intersection, refTangent, refTangentTS);
        }

        if (horizResult.points.length === 0) return null;

        // 4. Calculate Vertical Alignment
        const pEndXZ = horizResult.points[horizResult.points.length - 1];
        const vecStartToEnd = pEndXZ.sub(vectorTSStart);
        const distOnLine = vecStartToEnd.x * refTangentTS.x + vecStartToEnd.z * refTangentTS.z;
        const targetY = vectorTSStart.y + distOnLine * refSlopeTS;
        
        const curvePoints = horizResult.points;
        let dists = [0];
        let totalDist = 0;
        for(let j=1; j<curvePoints.length; j++) {
            const d = curvePoints[j].sub(curvePoints[j-1]).horizontalLength();
            totalDist += d;
            dists.push(totalDist);
        }

        // [Fix for Stats A calculation]
        const dx = pEndXZ.x - S.x;
        const dz = pEndXZ.z - S.z;
        const chordAngle = Math.atan2(dz, dx);
        const tanAngle = Math.atan2(refTangent.z, refTangent.x);
        let diffChord = chordAngle - tanAngle;
        while (diffChord <= -Math.PI) diffChord += 2 * Math.PI;
        while (diffChord > Math.PI) diffChord -= 2 * Math.PI;
        
        let trueTheta = Math.abs(diffChord) * 2;
        if (trueTheta < 0.01 && thetaReal > 0.1) {
             trueTheta = thetaReal;
        }
        
        const trueThetaDeg = trueTheta * 180 / Math.PI;

        let rampHeights;
        let stats = {
            type: type,
            R: Infinity,
            A: trueThetaDeg, 
            L: dists[dists.length - 1],
            h: targetY - S.y,
            g1: refSlope,
            g2: refSlopeTS 
        };

        if (trueTheta > 0.001) {
             const chord = Math.sqrt(dx*dx + dz*dz);
             stats.R = (chord / 2) / Math.sin(trueTheta / 2);
        }

        if (mode === MODES.MODE_B) {
            const pStartTemp = { y: S.y };
            const pEndTemp = { y: targetY };
            const s1Result = calculateS1Height(pStartTemp, pEndTemp, refSlope, dists);
            
            rampHeights = s1Result.heights;
            stats.g2 = s1Result.endSlope; 

        } else if (mode === MODES.MODE_B1) {
            rampHeights = calculateS2RampHeight(S.y, targetY, refSlope, refSlopeTS, dists);
            const L = stats.L; const dy = stats.h;
            const s = (dy*dy)/L; const expS = Math.exp(-s/2);
            const lp = (expS+1)*L/4; const lt = (2-2*expS)*L/4;
            stats.gT = (dy - 0.5*lp*(refSlope+refSlopeTS)) / (lp+lt);

        } else if (mode === MODES.MODE_B2) {
            rampHeights = calculateS3CrossHeight(S.y, targetY, refSlope, refSlopeTS, session.targetH, dists);
            stats.h = session.targetH; 

            // [Validation Feedback for B2 - English]
            const totalDy = targetY - S.y;
            if (!session.isRestoring) {
                if (session.targetH > 0 && totalDy > session.targetH) {
                    session.player.sendMessage(`§c[Warning] End height (${totalDy.toFixed(2)}) is higher than peak h (${session.targetH.toFixed(2)}).`);
                } else if (session.targetH < 0 && totalDy < session.targetH) {
                    session.player.sendMessage(`§c[Warning] End height (${totalDy.toFixed(2)}) is lower than min h (${session.targetH.toFixed(2)}).`);
                }
            }
            
            const L = stats.L; const dy = targetY - S.y;
            const userH = Math.abs(session.targetH);
            const k = Math.exp(-((2 * userH * userH) / L) / 2);
            const L_li = (14 + 16*k) * L / 105; const L_lo = L_li;
            const L_ti = (21 - 21*k) * L / 105; const L_to = L_ti;
            const L_c = (35 + 10*k) * L / 105;
            const KA = L_li/2 + L_ti + L_c/2; const KB = L_c/2 + L_to + L_lo/2;
            const RHS1 = dy - (refSlope * L_li/2) - (refSlopeTS * L_lo/2);
            const KC = L_li/2 + L_ti + (3*L_c/8); const KD = L_c/8;
            const RHS2 = session.targetH - (refSlope * L_li / 2);
            const Det = KA * KD - KB * KC;
            if (Math.abs(Det) > 1e-9) {
                stats.gT1 = (RHS1 * KD - RHS2 * KB) / Det;
                stats.gT2 = (KA * RHS2 - KC * RHS1) / Det;
            } else { stats.gT1 = 0; stats.gT2 = 0; }
        }

        const finalPoints = [];
        let previewCumulativeDist = [0];
        let totalLength3D = 0;
        
        for(let j=0; j<curvePoints.length; j++) {
            curvePoints[j].y = rampHeights[j];
            if (j > 0) {
                const dist3D = curvePoints[j].sub(curvePoints[j-1]).length();
                totalLength3D += dist3D;
                previewCumulativeDist.push(totalLength3D);
            }
            finalPoints.push(curvePoints[j]);
        }

        return {
            points: finalPoints,
            cumulativeDist: previewCumulativeDist,
            totalLength: totalLength3D,
            stats: stats
        };
    }
}
