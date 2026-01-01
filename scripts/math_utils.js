// scripts/math_utils.js

export class Vector3 {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    static fromBlockCenter(blockLoc) {
        return new Vector3(blockLoc.x + 0.5, blockLoc.y + 0.5, blockLoc.z + 0.5);
    }

    static fromObject(obj) {
        return new Vector3(obj.x, obj.y, obj.z);
    }

    add(v) { return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z); }
    sub(v) { return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z); }
    mul(s) { return new Vector3(this.x * s, this.y * s, this.z * s); }
    
    length() { return Math.sqrt(this.x**2 + this.y**2 + this.z**2); }
    horizontalLength() { return Math.sqrt(this.x**2 + this.z**2); }

    normalize() {
        const len = this.length();
        if (len === 0) return new Vector3(0, 0, 0);
        return new Vector3(this.x / len, this.y / len, this.z / len);
    }

    normalizeHorizontal() {
        const len = this.horizontalLength();
        if (len === 0) return new Vector3(0, 0, 0);
        return new Vector3(this.x / len, 0, this.z / len);
    }

    crossY() {
        return new Vector3(-this.z, 0, this.x);
    }

    static lerp(v1, v2, t) {
        return new Vector3(
            v1.x + (v2.x - v1.x) * t,
            v1.y + (v2.y - v1.y) * t,
            v1.z + (v2.z - v1.z) * t
        );
    }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getTargetSpiralRatio(thetaDeg) {
    if (thetaDeg <= 91) return 1/3;
    if (thetaDeg <= 181) return 1/4;
    if (thetaDeg <= 271) return 1/6;
    if (thetaDeg <= 315) return 1/8;
    return 0;
}

function transformUnitPointsToWorld(unitPoints, pStart, pTargetRef, startTanXZ, targetTanXZ, theta) {
    const vecStartTarget = { x: pStart.x - pTargetRef.x, z: pStart.z - pTargetRef.z };
    const realOffset = Math.abs(vecStartTarget.x * (-targetTanXZ.z) + vecStartTarget.z * targetTanXZ.x);

    const unitEnd = unitPoints[unitPoints.length-1];
    const unitOffset = Math.abs(Math.sin(theta)*unitEnd.x - Math.cos(theta)*unitEnd.y);

    if (unitOffset < 1e-9) return { points: [], arcLength: 0 }; 

    const scale = realOffset / unitOffset;

    const startAng = Math.atan2(startTanXZ.z, startTanXZ.x);
    const targetAng = Math.atan2(targetTanXZ.z, targetTanXZ.x);
    
    let diff = targetAng - startAng;
    while (diff <= -Math.PI) diff += 2 * Math.PI;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    const isCW = diff > 0;

    const yFlip = isCW ? 1 : -1; 
    const worldPoints = [];
    let arcLength = 0;
    const rot = Math.atan2(startTanXZ.z, startTanXZ.x);

    for(let i=0; i<unitPoints.length; i++) {
        const p = unitPoints[i];
        const px_sc = p.x * scale;
        const py_sc = p.y * scale * yFlip; 

        const rx = px_sc * Math.cos(rot) - py_sc * Math.sin(rot);
        const rz = px_sc * Math.sin(rot) + py_sc * Math.cos(rot);

        const tx = rx + pStart.x;
        const tz = rz + pStart.z;

        const currentPos = new Vector3(tx, 0, tz);
        
        if (i > 0) {
            const prevPos = worldPoints[i-1];
            const segLen = currentPos.sub(prevPos).length();
            arcLength += segLen;
            const tan = currentPos.sub(prevPos).normalize();
            prevPos.tangent = tan;
        }
        worldPoints.push(currentPos);
    }

    if (worldPoints.length > 0) {
        worldPoints[worldPoints.length-1].tangent = targetTanXZ;
        worldPoints[0].tangent = startTanXZ;
    }

    return { points: worldPoints, endTan: targetTanXZ, arcLength };
}

// ==========================================
// CORE CURVE CALCULATION
// ==========================================

export function calculateSimpleCurvePoints(pStart, pEnd, startTanXZ) {
    const dx = pEnd.x - pStart.x;
    const dz = pEnd.z - pStart.z;
    const chordLen = Math.sqrt(dx*dx + dz*dz);
    
    if (chordLen < 0.01) return { points: [], endTan: startTanXZ, arcLength: 0 };

    const chordAngle = Math.atan2(dz, dx);
    const tanAngle = Math.atan2(startTanXZ.z, startTanXZ.x);

    let diff = chordAngle - tanAngle;
    while (diff <= -Math.PI) diff += 2 * Math.PI;
    while (diff > Math.PI) diff -= 2 * Math.PI;

    const isCW = diff > 0;
    const theta = Math.abs(diff) * 2;
    
    let arcLength = chordLen;
    let R = 0;

    if (Math.abs(theta) > 0.001) {
        R = (chordLen / 2) / Math.sin(theta / 2);
        arcLength = R * theta;
    }

    const steps = Math.max(20, Math.ceil(arcLength * 2));

    const points = [];
    const endTanAngleVal = tanAngle + (isCW ? theta : -theta);
    const nextTan = new Vector3(Math.cos(endTanAngleVal), 0, Math.sin(endTanAngleVal));

    if (Math.abs(theta) < 0.001) {
        for(let i=0; i<=steps; i++) {
            const t = i/steps;
            const pt = new Vector3(pStart.x + dx * t, 0, pStart.z + dz * t);
            
            // [UPDATED] Use Chord-based Tangent for consistency
            if (i > 0) {
                const prev = points[i-1];
                const tan = pt.sub(prev).normalize();
                prev.tangent = tan;
            }
            points.push(pt);
        }
        points[0].tangent = startTanXZ;
        points[points.length-1].tangent = startTanXZ; // Straight line
        
        return { points, endTan: startTanXZ, arcLength: chordLen };
    }

    let nx, nz;
    if (isCW) { nx = -startTanXZ.z; nz = startTanXZ.x; }
    else { nx = startTanXZ.z; nz = -startTanXZ.x; }

    const cx = pStart.x + R * nx;
    const cz = pStart.z + R * nz;

    const startAngle = Math.atan2(pStart.z - cz, pStart.x - cx);
    const endAngle = Math.atan2(pEnd.z - cz, pEnd.x - cx);

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        let currentAngle;
        if (!isCW) {
             let sweep = endAngle - startAngle;
             if (sweep > 0) sweep -= 2 * Math.PI;
             currentAngle = startAngle + sweep * t;
        } else {
            let sweep = endAngle - startAngle;
            if (sweep < 0) sweep += 2 * Math.PI;
            currentAngle = startAngle + sweep * t;
        }

        const px = cx + R * Math.cos(currentAngle);
        const pz = cz + R * Math.sin(currentAngle);
        
        const pt = new Vector3(px, 0, pz);
        
        // [UPDATED] ใช้ Chord-based Tangent แทน Analytical
        // เพื่อให้ทิศทางสอดคล้องกับเส้นจริง 100% แก้ปัญหาโครงสร้างกลับด้านและติ่งเกิน
        if (i > 0) {
            const prev = points[i-1];
            const tan = pt.sub(prev).normalize();
            prev.tangent = tan;
        }
        
        points.push(pt);
    }

    // Fix tangents at boundaries
    if (points.length > 0) {
        // บังคับจุดแรกให้ใช้ startTanXZ (เพื่อให้เชื่อมกับ t1 หรือโค้งก่อนหน้าได้สนิท)
        points[0].tangent = startTanXZ;
        
        // จุดสุดท้ายใช้ nextTan (Analytical) หรือจะใช้ tangent ของ segment สุดท้ายก็ได้
        // การใช้ Analytical ที่จุดจบจะช่วยเรื่องความแม่นยำของการส่งต่อ t2
        points[points.length-1].tangent = nextTan;
    }

    return { points, endTan: nextTan, arcLength };
}

export function calculateSpiralCurvePoints(pStart, pEnd, startTanXZ) {
    const dx = pEnd.x - pStart.x;
    const dz = pEnd.z - pStart.z;
    const chordLen = Math.sqrt(dx*dx + dz*dz);

    if (chordLen < 0.01) return { points: [], endTan: startTanXZ, arcLength: 0 };

    const chordAngle = Math.atan2(dz, dx);
    const tanAngle = Math.atan2(startTanXZ.z, startTanXZ.x);

    let diff = chordAngle - tanAngle;
    while (diff <= -Math.PI) diff += 2 * Math.PI;
    while (diff > Math.PI) diff -= 2 * Math.PI;

    const isCW = diff > 0;
    const theta = Math.abs(diff) * 2;
    const thetaDeg = theta * 180 / Math.PI;

    if (thetaDeg < 1) return calculateSimpleCurvePoints(pStart, pEnd, startTanXZ);

    const targetRatio = getTargetSpiralRatio(thetaDeg);
    if (targetRatio === 0) return calculateSimpleCurvePoints(pStart, pEnd, startTanXZ);

    const tauS1 = (targetRatio * theta) / (2 * (1 - targetRatio));
    if (tauS1 * 2 >= theta) return calculateSimpleCurvePoints(pStart, pEnd, startTanXZ);

    const R_unit = 1;
    const L_spiral = 2 * R_unit * tauS1; 
    
    const spiralSteps = 40; 
    const dt = L_spiral / spiralSteps;
    
    let cx = 0, cy = 0;
    const unitPoints = [];
    unitPoints.push({x:0, y:0});

    for (let i=1; i<=spiralSteps; i++) {
        const tMid = (i - 0.5) * dt; 
        const tau = (tMid*tMid * tauS1) / (L_spiral*L_spiral); 
        cx += Math.cos(tau) * dt; 
        cy += Math.sin(tau) * dt; 
        unitPoints.push({x:cx, y:cy});
    }

    const endS1 = unitPoints[unitPoints.length-1];
    const nx = -Math.sin(tauS1);
    const ny = Math.cos(tauS1);
    const CenX = endS1.x + R_unit * nx;
    const CenY = endS1.y + R_unit * ny;

    const arcSteps = 20; 
    const halfArcSweep = (theta - 2 * tauS1) / 2;
    
    for(let i=1; i<=arcSteps; i++) {
        const angle = tauS1 + (i/arcSteps) * halfArcSweep;
        unitPoints.push({
            x: CenX + R_unit * Math.sin(angle), 
            y: CenY - R_unit * Math.cos(angle)
        });
    }

    const trueMidPt = unitPoints[unitPoints.length-1];
    const axisAngle = tauS1 + halfArcSweep + Math.PI/2;
    const c = Math.cos(-axisAngle), s = Math.sin(-axisAngle);
    const c2 = Math.cos(axisAngle), s2 = Math.sin(axisAngle);

    const lenUnitPoints = unitPoints.length;
    for(let i = lenUnitPoints-2; i>=0; i--) {
        const p = unitPoints[i];
        const dxLocal = p.x - trueMidPt.x;
        const dyLocal = p.y - trueMidPt.y;
        const rx = dxLocal*c - dyLocal*s;
        const ry = dxLocal*s + dyLocal*c;
        const fx = rx*c2 - (-ry)*s2;
        const fy = rx*s2 + (-ry)*c2;
        
        unitPoints.push({
            x: trueMidPt.x + fx,
            y: trueMidPt.y + fy
        });
    }

    const unitEnd = unitPoints[unitPoints.length-1];
    const unitDist = Math.sqrt(unitEnd.x**2 + unitEnd.y**2);
    const scale = chordLen / unitDist;

    const yFlip = isCW ? 1 : -1;
    const worldPoints = [];
    let arcLength = 0;

    const rot = Math.atan2(startTanXZ.z, startTanXZ.x);

    for(let i=0; i<unitPoints.length; i++) {
        const p = unitPoints[i];
        const px_sc = p.x * scale;
        const py_sc = p.y * scale * yFlip;

        const rx = px_sc * Math.cos(rot) - py_sc * Math.sin(rot);
        const rz = px_sc * Math.sin(rot) + py_sc * Math.cos(rot);

        const tx = rx + pStart.x;
        const tz = rz + pStart.z;

        const currentPos = new Vector3(tx, 0, tz);
        
        if (i > 0) {
            const prevPos = worldPoints[i-1];
            const segLen = currentPos.sub(prevPos).length();
            arcLength += segLen;
            const tan = currentPos.sub(prevPos).normalize();
            prevPos.tangent = tan;
        }

        worldPoints.push(currentPos);
    }

    const endTanAngleVal = tanAngle + (isCW ? theta : -theta);
    const nextTan = new Vector3(Math.cos(endTanAngleVal), 0, Math.sin(endTanAngleVal));
    
    if (worldPoints.length > 0) {
        worldPoints[worldPoints.length-1].tangent = nextTan;
        worldPoints[0].tangent = startTanXZ;
    }

    return { points: worldPoints, endTan: nextTan, arcLength };
}

export function calculateCWTCurvePoints(pStart, pEnd, startTanXZ) {
    const dx = pEnd.x - pStart.x;
    const dz = pEnd.z - pStart.z;
    const chordLen = Math.sqrt(dx*dx + dz*dz);

    if (chordLen < 0.01) return { points: [], endTan: startTanXZ, arcLength: 0 };

    const chordAngle = Math.atan2(dz, dx);
    const tanAngle = Math.atan2(startTanXZ.z, startTanXZ.x);

    let diff = chordAngle - tanAngle;
    while (diff <= -Math.PI) diff += 2 * Math.PI;
    while (diff > Math.PI) diff -= 2 * Math.PI;

    const isCW = diff > 0;
    const theta = Math.abs(diff) * 2;
    const thetaDeg = theta * 180 / Math.PI;

    if (thetaDeg < 14.9 || thetaDeg > 180.1) {
        return calculateSimpleCurvePoints(pStart, pEnd, startTanXZ);
    }

    const beta = Math.atan(1/8); 
    const effTheta = theta - 2 * beta; 
    
    const R_unit = 1 / Math.tan(effTheta / 2);
    
    const unitPoints = [];
    unitPoints.push({x:0, y:0}); 

    const pEndTaper1 = { x: Math.cos(beta), y: Math.sin(beta) };
    for(let i=1; i<=10; i++) {
        const t = i/10;
        unitPoints.push({ x: pEndTaper1.x * t, y: pEndTaper1.y * t });
    }

    const nx = -Math.sin(beta);
    const ny = Math.cos(beta);
    const CenX = pEndTaper1.x + R_unit * nx;
    const CenY = pEndTaper1.y + R_unit * ny;
    
    const arcSteps = 30; 
    const startAngRel = beta - Math.PI/2;
    
    for(let i=0; i<=arcSteps; i++) {
        const ang = startAngRel + (i/arcSteps) * effTheta;
        unitPoints.push({
            x: CenX + R_unit * Math.cos(ang), 
            y: CenY + R_unit * Math.sin(ang)
        });
    }
    
    const pEndArc = unitPoints[unitPoints.length-1];
    const exitAngle = theta - beta; 
    const pEndTaper2 = { 
        x: pEndArc.x + Math.cos(exitAngle), 
        y: pEndArc.y + Math.sin(exitAngle) 
    };

    for(let i=1; i<=10; i++) {
        const t = i/10;
        unitPoints.push({
            x: pEndArc.x + (pEndTaper2.x - pEndArc.x) * t,
            y: pEndArc.y + (pEndTaper2.y - pEndArc.y) * t
        });
    }

    const unitEnd = unitPoints[unitPoints.length-1];
    const unitDist = Math.sqrt(unitEnd.x**2 + unitEnd.y**2);
    const scale = chordLen / unitDist;

    const yFlip = isCW ? 1 : -1;
    const worldPoints = [];
    let arcLength = 0;

    const rot = Math.atan2(startTanXZ.z, startTanXZ.x);

    for(let i=0; i<unitPoints.length; i++) {
        const p = unitPoints[i];
        const px_sc = p.x * scale;
        const py_sc = p.y * scale * yFlip;

        const rx = px_sc * Math.cos(rot) - py_sc * Math.sin(rot);
        const rz = px_sc * Math.sin(rot) + py_sc * Math.cos(rot);

        const tx = rx + pStart.x;
        const tz = rz + pStart.z;

        const currentPos = new Vector3(tx, 0, tz);
        
        if (i > 0) {
            const prevPos = worldPoints[i-1];
            const segLen = currentPos.sub(prevPos).length();
            arcLength += segLen;
            const tan = currentPos.sub(prevPos).normalize();
            prevPos.tangent = tan;
        }

        worldPoints.push(currentPos);
    }

    const endTanAngleVal = tanAngle + (isCW ? theta : -theta);
    const nextTan = new Vector3(Math.cos(endTanAngleVal), 0, Math.sin(endTanAngleVal));
    
    if (worldPoints.length > 0) {
        worldPoints[worldPoints.length-1].tangent = nextTan;
        worldPoints[0].tangent = startTanXZ;
    }

    return { points: worldPoints, endTan: nextTan, arcLength };
}

// [UPDATED] Calculate Full Circle (Roundabout) with Chord-based Tangents
export function calculateCirclePoints(center, startPoint) {
    const dx = startPoint.x - center.x;
    const dz = startPoint.z - center.z;
    const R = Math.sqrt(dx*dx + dz*dz);
    
    if (R < 0.01) return { points: [], totalLength: 0 };

    const startAngle = Math.atan2(dz, dx);
    const circumference = 2 * Math.PI * R;
    const steps = Math.max(40, Math.ceil(circumference * 2));
    const points = [];
    
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const currentAngle = startAngle + t * (2 * Math.PI); 
        
        const px = center.x + R * Math.cos(currentAngle);
        const pz = center.z + R * Math.sin(currentAngle);
        
        const pt = new Vector3(px, center.y, pz); 

        // [UPDATED] Chord-based Tangent for consistency
        if (i > 0) {
            const prev = points[i-1];
            const tan = pt.sub(prev).normalize();
            prev.tangent = tan;
        }
        
        points.push(pt);
    }
    
    // Fix Last Tangent (Circle loops back to start)
    if (points.length > 0) {
        // Tangent of last point should point to... the first point? 
        // Or analytical tangent at end.
        const tx = -Math.sin(startAngle);
        const tz = Math.cos(startAngle);
        points[points.length-1].tangent = new Vector3(tx, 0, tz).normalize();

        // Fix First Tangent (Analytical start)
        // Tangent at start angle: (-sin, cos)
        const stx = -Math.sin(startAngle);
        const stz = Math.cos(startAngle);
        points[0].tangent = new Vector3(stx, 0, stz).normalize();
    }
    
    return { points, totalLength: circumference };
}

// ==========================================
// VERTICAL & OTHER
// ==========================================

export function calculateS1Height(pStart, pEnd, startSlope, horizontalDistances) {
    const totalDist = horizontalDistances[horizontalDistances.length - 1];
    if (totalDist < 0.001) {
        const heights = new Array(horizontalDistances.length).fill(pStart.y);
        return { heights, endSlope: startSlope };
    }
    const cpDist = totalDist / 2;
    const cpY = pStart.y + startSlope * cpDist;
    const heights = [];
    for (let i = 0; i < horizontalDistances.length; i++) {
        const t = horizontalDistances[i] / totalDist;
        const y = Math.pow(1 - t, 2) * pStart.y + 
                  2 * (1 - t) * t * cpY + 
                  Math.pow(t, 2) * pEnd.y;
        heights.push(y);
    }
    const mChord = (pEnd.y - pStart.y) / totalDist;
    const nextSlope = 2 * mChord - startSlope;
    return { heights, endSlope: nextSlope };
}

export function calculateS2RampHeight(yStart, yEnd, m1, m2, horizontalDistances) {
    const L = horizontalDistances[horizontalDistances.length - 1];
    if (L < 0.001) {
        return new Array(horizontalDistances.length).fill(yStart);
    }
    const totalDy = yEnd - yStart; 
    const s = (totalDy * totalDy) / L;
    const expS = Math.exp(-s / 2); 
    const lp = (expS + 1) * L / 4; 
    const lt = (2 - 2 * expS) * L / 4; 
    const mt = (totalDy - 0.5 * lp * (m1 + m2)) / (lp + lt);
    const x1 = 0; const x2 = lp; const x3 = x2 + lt; const x4 = L;
    const y1 = yStart; const y2 = y1 + ((m1 + mt) / 2) * lp; const y3 = y2 + mt * lt;
    const cp1y = y1 + m1 * (x2 - x1) / 2; 
    const cp2y = y3 + mt * (x4 - x3) / 2;
    const heights = [];
    for (let i = 0; i < horizontalDistances.length; i++) {
        const d = horizontalDistances[i];
        let y = yStart;
        if (d <= x2) {
            const t = d / x2;
            y = (1-t)**2 * y1 + 2*(1-t)*t * cp1y + t**2 * y2;
        } else if (d <= x3) {
            const t = (d - x2) / lt;
            y = y2 + (y3 - y2) * t;
        } else {
            const t = (d - x3) / lp;
            y = (1-t)**2 * y3 + 2*(1-t)*t * cp2y + t**2 * yEnd;
        }
        heights.push(y);
    }
    return heights;
}

export function calculateS3CrossHeight(yStart, yEnd, m1, m2, targetH, horizontalDistances) {
    const L = horizontalDistances[horizontalDistances.length - 1];
    if (L < 0.001) {
        return new Array(horizontalDistances.length).fill(yStart);
    }
    const userH = Math.abs(targetH);
    const k = Math.exp(-((2 * userH * userH) / L) / 2);
    const L_li = (14 + 16*k) * L / 105;
    const L_ti = (21 - 21*k) * L / 105;
    const L_c = (35 + 10*k) * L / 105;
    const L_to = L_ti;
    const L_lo = L_li;
    const dY_total = yEnd - yStart;
    const L1=L_li, L2=L_ti, L3=L_c, L4=L_to, L5=L_lo;
    const KA = L1/2 + L2 + L3/2;
    const KB = L3/2 + L4 + L5/2;
    const RHS1 = dY_total - (m1 * L1/2) - (m2 * L5/2);
    const KC = L1/2 + L2 + (3*L3/8);
    const KD = L3/8;
    const target_dY_mid = targetH;
    const RHS2 = target_dY_mid - (m1 * L1 / 2);
    const Det = KA * KD - KB * KC;
    let min, mout;
    if (Math.abs(Det) < 1e-9) { 
        min = 0; mout = 0; 
    } else {
        min = (RHS1 * KD - RHS2 * KB) / Det;
        mout = (KA * RHS2 - KC * RHS1) / Det;
    }
    const x1 = L1; const x2 = x1 + L2; const x3 = x2 + L3; const x4 = x3 + L4; const x5 = L;
    const y0 = yStart;
    const y1 = y0 + (m1 + min)/2 * L1;
    const y2 = y1 + min * L2;
    const y3 = y2 + (min + mout)/2 * L3;
    const y4 = y3 + mout * L4;
    const cp1y = y0 + m1 * (L1 / 2); 
    const cp2y = y2 + min * (L3 / 2); 
    const cp3y = y4 + mout * (L5 / 2); 
    const heights = [];
    for (let i = 0; i < horizontalDistances.length; i++) {
        const d = horizontalDistances[i];
        let y = yStart;
        if (d <= x1) {
            const t = d / x1;
            y = (1-t)**2 * y0 + 2*(1-t)*t * cp1y + t**2 * y1;
        } else if (d <= x2) {
            const t = (d - x1) / L2;
            y = y1 + (y2 - y1) * t;
        } else if (d <= x3) {
            const t = (d - x2) / L3;
            y = (1-t)**2 * y2 + 2*(1-t)*t * cp2y + t**2 * y3;
        } else if (d <= x4) {
            const t = (d - x3) / L4;
            y = y3 + (y4 - y3) * t;
        } else {
            const t = (d - x4) / L5;
            y = (1-t)**2 * y4 + 2*(1-t)*t * cp3y + t**2 * yEnd;
        }
        heights.push(y);
    }
    return heights;
}

// Wrapper Exports
export function getIntersectionXZ(p1, v1, p2, v2) {
    const det = v1.x * (-v2.z) - v1.z * (-v2.x);
    if (Math.abs(det) < 1e-9) return null;
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const t = (dx * (-v2.z) - dz * (-v2.x)) / det;
    return new Vector3(p1.x + t * v1.x, 0, p1.z + t * v1.z);
}

export function calculateSimpleCurveFromIntersection(pStart, pInt, startTanXZ, targetTanXZ) {
    const distToInt = Math.sqrt((pInt.x - pStart.x)**2 + (pInt.z - pStart.z)**2);
    const vecIntToStart = { x: pStart.x - pInt.x, z: pStart.z - pInt.z };
    const dot = vecIntToStart.x * startTanXZ.x + vecIntToStart.z * startTanXZ.z;
    const dirFactor = (dot < 0) ? 1 : -1;
    const pEnd = new Vector3(
        pInt.x + targetTanXZ.x * distToInt * dirFactor,
        0,
        pInt.z + targetTanXZ.z * distToInt * dirFactor
    );
    return calculateSimpleCurvePoints(pStart, pEnd, startTanXZ);
}

export function calculateSpiralCurveFromIntersection(pStart, pInt, startTanXZ, targetTanXZ) {
    const distToInt = Math.sqrt((pInt.x - pStart.x)**2 + (pInt.z - pStart.z)**2);
    const vecIntToStart = { x: pStart.x - pInt.x, z: pStart.z - pInt.z };
    const dot = vecIntToStart.x * startTanXZ.x + vecIntToStart.z * startTanXZ.z;
    const dirFactor = (dot < 0) ? 1 : -1;
    const pEnd = new Vector3(
        pInt.x + targetTanXZ.x * distToInt * dirFactor,
        0,
        pInt.z + targetTanXZ.z * distToInt * dirFactor
    );
    return calculateSpiralCurvePoints(pStart, pEnd, startTanXZ);
}

export function calculateCWTCurveFromIntersection(pStart, pInt, startTanXZ, targetTanXZ) {
    const distToInt = Math.sqrt((pInt.x - pStart.x)**2 + (pInt.z - pStart.z)**2);
    const vecIntToStart = { x: pStart.x - pInt.x, z: pStart.z - pInt.z };
    const dot = vecIntToStart.x * startTanXZ.x + vecIntToStart.z * startTanXZ.z;
    const dirFactor = (dot < 0) ? 1 : -1;
    const pEnd = new Vector3(
        pInt.x + targetTanXZ.x * distToInt * dirFactor,
        0,
        pInt.z + targetTanXZ.z * distToInt * dirFactor
    );
    return calculateCWTCurvePoints(pStart, pEnd, startTanXZ);
}

export function calculateRRRCurveFromIntersection(pStart, pInt, startTanXZ, targetTanXZ) {
    const ang1 = Math.atan2(startTanXZ.z, startTanXZ.x);
    const ang2 = Math.atan2(targetTanXZ.z, targetTanXZ.x);
    let diff = ang2 - ang1;
    while (diff <= -Math.PI) diff += 2 * Math.PI;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    let isCW = diff > 0;
    let theta = Math.abs(diff);
    if (pInt) {
        const vecIntToStart = { x: pStart.x - pInt.x, z: pStart.z - pInt.z };
        const dot = vecIntToStart.x * startTanXZ.x + vecIntToStart.z * startTanXZ.z;
        if (dot > 0) {
            theta = 2 * Math.PI - theta;
            isCW = !isCW;
        }
    }
    const thetaDeg = theta * 180 / Math.PI;
    if (thetaDeg <= 0 || thetaDeg > 180.1) {
        return calculateSimpleCurvePoints(pStart, pStart.add(startTanXZ.mul(10)), startTanXZ);
    }
    const thetaOverPi = theta / Math.PI; 
    const r1_unit = (93 - 30 * thetaOverPi); 
    const r2_unit = (38 - 24 * thetaOverPi); 
    const r3_unit = (51 + 54 * thetaOverPi);
    const sweep2 = (2/3) * theta; const sweep1 = (theta / 6); const sweep3 = (theta / 6);
    const unitPoints = []; unitPoints.push({x:0, y:0}); 
    const steps = 15;
    for(let i=1; i<=steps; i++) { 
        const ang = (i/steps)*sweep1; 
        unitPoints.push({ x: r1_unit * Math.sin(ang), y: r1_unit * (1 - Math.cos(ang)) }); 
    }
    let lastP = unitPoints[unitPoints.length-1]; 
    let absAngle = sweep1; 
    let CenX = lastP.x - r2_unit * Math.sin(absAngle); 
    let CenY = lastP.y + r2_unit * Math.cos(absAngle); 
    let startAngC = absAngle - Math.PI/2;
    for(let i=1; i<=steps; i++) { 
        const ang = startAngC + (i/steps)*sweep2; 
        unitPoints.push({ x: CenX + r2_unit * Math.cos(ang), y: CenY + r2_unit * Math.sin(ang) }); 
    }
    lastP = unitPoints[unitPoints.length-1]; 
    absAngle = sweep1 + sweep2; 
    CenX = lastP.x - r3_unit * Math.sin(absAngle); 
    CenY = lastP.y + r3_unit * Math.cos(absAngle); 
    startAngC = absAngle - Math.PI/2;
    for(let i=1; i<=steps; i++) { 
        const ang = startAngC + (i/steps)*sweep3; 
        unitPoints.push({ x: CenX + r3_unit * Math.cos(ang), y: CenY + r3_unit * Math.sin(ang) }); 
    }
    return transformUnitPointsToWorld(unitPoints, pStart, pInt, startTanXZ, targetTanXZ, theta); // Using common transform
}

export function calculateSimpleCurveFromParallel(pStart, pTargetRef, startTanXZ, targetTanXZ, theta) {
    const steps = 40;
    const unitPoints = [];
    for(let i=0; i<=steps; i++) {
        const t = (i/steps) * theta;
        unitPoints.push({ x: Math.sin(t), y: 1 - Math.cos(t) });
    }
    return transformUnitPointsToWorld(unitPoints, pStart, pTargetRef, startTanXZ, targetTanXZ, theta);
}

export function calculateSpiralCurveFromParallel(pStart, pTargetRef, startTanXZ, targetTanXZ, theta) {
    const thetaDeg = theta * 180 / Math.PI;
    const targetRatio = getTargetSpiralRatio(thetaDeg);
    if (targetRatio === 0) return calculateSimpleCurveFromParallel(pStart, pTargetRef, startTanXZ, targetTanXZ, theta);
    const tauS1 = (targetRatio * theta) / (2 * (1 - targetRatio));
    const R_unit = 1;
    const L_spiral = 2 * R_unit * tauS1; 
    const spiralSteps = 40; 
    const dt = L_spiral / spiralSteps;
    let cx = 0, cy = 0;
    const unitPoints = [];
    unitPoints.push({x:0, y:0});
    for (let i=1; i<=spiralSteps; i++) {
        const tMid = (i - 0.5) * dt; 
        const tau = (tMid*tMid * tauS1) / (L_spiral*L_spiral); 
        cx += Math.cos(tau) * dt; 
        cy += Math.sin(tau) * dt; 
        unitPoints.push({x:cx, y:cy});
    }
    const endS1 = unitPoints[unitPoints.length-1];
    const nx = -Math.sin(tauS1);
    const ny = Math.cos(tauS1);
    const CenX = endS1.x + R_unit * nx;
    const CenY = endS1.y + R_unit * ny;
    const arcSteps = 20; 
    const halfArcSweep = (theta - 2 * tauS1) / 2;
    for(let i=1; i<=arcSteps; i++) {
        const angle = tauS1 + (i/arcSteps) * halfArcSweep;
        unitPoints.push({
            x: CenX + R_unit * Math.sin(angle), 
            y: CenY - R_unit * Math.cos(angle)
        });
    }
    const trueMidPt = unitPoints[unitPoints.length-1];
    const axisAngle = tauS1 + halfArcSweep + Math.PI/2;
    const c = Math.cos(-axisAngle), s = Math.sin(-axisAngle);
    const c2 = Math.cos(axisAngle), s2 = Math.sin(axisAngle);
    const lenUnitPoints = unitPoints.length;
    for(let i = lenUnitPoints-2; i>=0; i--) {
        const p = unitPoints[i];
        const dxLocal = p.x - trueMidPt.x;
        const dyLocal = p.y - trueMidPt.y;
        const rx = dxLocal*c - dyLocal*s;
        const ry = dxLocal*s + dyLocal*c;
        const fx = rx*c2 - (-ry)*s2;
        const fy = rx*s2 + (-ry)*c2;
        unitPoints.push({
            x: trueMidPt.x + fx,
            y: trueMidPt.y + fy
        });
    }
    return transformUnitPointsToWorld(unitPoints, pStart, pTargetRef, startTanXZ, targetTanXZ, theta);
}

export function calculateCWTCurveFromParallel(pStart, pTargetRef, startTanXZ, targetTanXZ, theta) {
    const thetaDeg = theta * 180 / Math.PI;
    if (thetaDeg < 14.9 || thetaDeg > 180.1) {
        return calculateSimpleCurveFromParallel(pStart, pTargetRef, startTanXZ, targetTanXZ, theta);
    }
    const beta = Math.atan(1/8); 
    const effTheta = theta - 2 * beta; 
    const R_unit = 1 / Math.tan(effTheta / 2);
    const unitPoints = [];
    unitPoints.push({x:0, y:0}); 
    const pEndTaper1 = { x: Math.cos(beta), y: Math.sin(beta) };
    for(let i=1; i<=10; i++) {
        const t = i/10;
        unitPoints.push({ x: pEndTaper1.x * t, y: pEndTaper1.y * t });
    }
    const nx = -Math.sin(beta);
    const ny = Math.cos(beta);
    const CenX = pEndTaper1.x + R_unit * nx;
    const CenY = pEndTaper1.y + R_unit * ny;
    const arcSteps = 30; 
    const startAngRel = beta - Math.PI/2;
    for(let i=0; i<=arcSteps; i++) {
        const ang = startAngRel + (i/arcSteps) * effTheta;
        unitPoints.push({
            x: CenX + R_unit * Math.cos(ang), 
            y: CenY + R_unit * Math.sin(ang)
        });
    }
    const pEndArc = unitPoints[unitPoints.length-1];
    const exitAngle = theta - beta; 
    const pEndTaper2 = { 
        x: pEndArc.x + Math.cos(exitAngle), 
        y: pEndArc.y + Math.sin(exitAngle) 
    };
    for(let i=1; i<=10; i++) {
        const t = i/10;
        unitPoints.push({
            x: pEndArc.x + (pEndTaper2.x - pEndArc.x) * t,
            y: pEndArc.y + (pEndTaper2.y - pEndArc.y) * t
        });
    }
    return transformUnitPointsToWorld(unitPoints, pStart, pTargetRef, startTanXZ, targetTanXZ, theta);
}

export function calculateRRRCurveFromParallel(pStart, pTargetRef, startTanXZ, targetTanXZ, theta) {
    const thetaOverPi = theta / Math.PI; 
    const r1_unit = (93 - 30 * thetaOverPi); 
    const r2_unit = (38 - 24 * thetaOverPi); 
    const r3_unit = (51 + 54 * thetaOverPi);
    const sweep2 = (2/3) * theta;   
    const sweep1 = (theta / 6);     
    const sweep3 = (theta / 6);     
    const unitPoints = []; 
    unitPoints.push({x:0, y:0}); 
    const steps = 15;
    for(let i=1; i<=steps; i++) { 
        const ang = (i/steps)*sweep1; 
        unitPoints.push({ x: r1_unit * Math.sin(ang), y: r1_unit * (1 - Math.cos(ang)) }); 
    }
    let lastP = unitPoints[unitPoints.length-1]; 
    let absAngle = sweep1; 
    let CenX = lastP.x - r2_unit * Math.sin(absAngle); 
    let CenY = lastP.y + r2_unit * Math.cos(absAngle); 
    let startAngC = absAngle - Math.PI/2;
    for(let i=1; i<=steps; i++) { 
        const ang = startAngC + (i/steps)*sweep2; 
        unitPoints.push({ x: CenX + r2_unit * Math.cos(ang), y: CenY + r2_unit * Math.sin(ang) }); 
    }
    lastP = unitPoints[unitPoints.length-1]; 
    absAngle = sweep1 + sweep2; 
    CenX = lastP.x - r3_unit * Math.sin(absAngle); 
    CenY = lastP.y + r3_unit * Math.cos(absAngle); 
    startAngC = absAngle - Math.PI/2;
    for(let i=1; i<=steps; i++) { 
        const ang = startAngC + (i/steps)*sweep3; 
        unitPoints.push({ x: CenX + r3_unit * Math.cos(ang), y: CenY + r3_unit * Math.sin(ang) }); 
    }
    return transformUnitPointsToWorld(unitPoints, pStart, pTargetRef, startTanXZ, targetTanXZ, theta);
}
