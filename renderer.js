// scripts/renderer.js
import { CONFIG } from './config.js';

export class Renderer {
    static spawnSafe(dimension, particleId, location) {
        try {
            dimension.spawnParticle(particleId, location);
        } catch (e) { }
    }

    // Helper: เช็คระยะห่างจากผู้เล่น
    static isVisible(playerPos, targetPos) {
        if (!playerPos || !targetPos) return false;
        const dx = playerPos.x - targetPos.x;
        const dy = playerPos.y - targetPos.y;
        const dz = playerPos.z - targetPos.z;
        // ใช้ Manhattan Distance หรือ Squared Distance แบบหยาบๆ เพื่อความเร็ว
        // (dx*dx + dy*dy + dz*dz) เทียบกับ R*R
        const distSq = dx*dx + dy*dy + dz*dz;
        const maxDistSq = CONFIG.RENDER_DISTANCE * CONFIG.RENDER_DISTANCE;
        return distSq <= maxDistSq;
    }

    static drawPoint(dimension, pos, playerPos) {
        if (!this.isVisible(playerPos, pos)) return;

        const offset = 0.55;
        // ลดจำนวนมุมลง หรือวาดเฉพาะมุมที่จำเป็นก็ได้ แต่ Balloon Gas ก้อนใหญ่ 
        // วาด 8 มุมอาจจะรกไปสำหรับการมองไกลๆ แต่คงไว้ตามเดิมเพื่อความชัดเจนตอนใกล้
        const corners = [
            {x:1,y:1,z:1}, {x:1,y:1,z:-1}, {x:1,y:-1,z:1}, {x:1,y:-1,z:-1},
            {x:-1,y:1,z:1}, {x:-1,y:1,z:-1}, {x:-1,y:-1,z:1}, {x:-1,y:-1,z:-1}
        ];
        
        for(let c of corners) {
            this.spawnSafe(dimension, CONFIG.PARTICLE_POINT, {
                x: pos.x + c.x * offset,
                y: pos.y + c.y * offset,
                z: pos.z + c.z * offset
            });
        }
    }

    static drawSelectedPoint(dimension, pos, playerPos) {
        if (!this.isVisible(playerPos, pos)) return;

        const offset = 0.6; 
        const corners = [
            {x:1,y:1,z:1}, {x:1,y:1,z:-1}, {x:1,y:-1,z:1}, {x:1,y:-1,z:-1},
            {x:-1,y:1,z:1}, {x:-1,y:1,z:-1}, {x:-1,y:-1,z:1}, {x:-1,y:-1,z:-1}
        ];
        
        for(let c of corners) {
            this.spawnSafe(dimension, CONFIG.PARTICLE_SELECTED, {
                x: pos.x + c.x * offset,
                y: pos.y + c.y * offset,
                z: pos.z + c.z * offset
            });
        }
    }

    static drawVector(dimension, p1, p2, playerPos) {
        // เช็คระยะที่จุดกึ่งกลาง
        const mid = { x: (p1.x+p2.x)/2, y: (p1.y+p2.y)/2, z: (p1.z+p2.z)/2 };
        if (!this.isVisible(playerPos, mid)) return;

        const dist = Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2 + (p1.z-p2.z)**2);
        
        // [OPTIMIZED] Blue Flame: ลดความหนาแน่นลง
        // จากเดิม ceil(dist * 2) (ทุก 0.5 บล็อก) -> เป็น ceil(dist) (ทุก 1 บล็อก)
        // หรือถ้าอยากให้เนียนหน่อยใช้ 1.5
        const steps = Math.ceil(dist * 1.5);

        for(let i=0; i<=steps; i++) {
            const t = i/steps;
            this.spawnSafe(dimension, CONFIG.PARTICLE_LINE, {
                x: p1.x + (p2.x - p1.x) * t,
                y: p1.y + (p2.y - p1.y) * t,
                z: p1.z + (p2.z - p1.z) * t
            });
        }
    }

    static drawGuideLine(dimension, p1, p2, playerPos) {
        // [UPDATED] Infinite Length Guide Line
        // คำนวณ Vector ทิศทางของเส้น
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        const lenSq = dx*dx + dy*dy + dz*dz;
        if (lenSq === 0) return;
        
        const len = Math.sqrt(lenSq);
        const dir = { x: dx/len, y: dy/len, z: dz/len };

        // Project ตำแหน่งผู้เล่นลงบนเส้นตรง (หาตำแหน่งบนเส้นที่ใกล้ผู้เล่นที่สุด)
        // สูตร: P_proj = p1 + t * dir, โดย t = dot(player - p1, dir)
        const vx = playerPos.x - p1.x;
        const vy = playerPos.y - p1.y;
        const vz = playerPos.z - p1.z;
        const t = vx * dir.x + vy * dir.y + vz * dir.z;

        // กำหนดระยะการมองเห็นรอบตัวผู้เล่น (Render Distance)
        // วาดเฉพาะส่วนของเส้นที่อยู่ในระยะสายตา เพื่อประสิทธิภาพ
        const viewRange = 80; 
        
        const tStart = t - viewRange;
        const tEnd = t + viewRange;

        // Snap เข้า Grid (ป้องกันเส้นสั่นเวลาเดิน)
        const step = 2; // วาดทุกๆ 2 บล็อก
        const gridStart = Math.floor(tStart / step) * step;

        for (let d = gridStart; d <= tEnd; d += step) {
            this.spawnSafe(dimension, CONFIG.PARTICLE_GUIDE, {
                x: p1.x + dir.x * d,
                y: p1.y + dir.y * d,
                z: p1.z + dir.z * d
            });
        }
    }
    
    static drawAxis(dimension, p1, p2, playerPos) {
        const mid = { x: (p1.x+p2.x)/2, y: (p1.y+p2.y)/2, z: (p1.z+p2.z)/2 };
        if (!this.isVisible(playerPos, mid)) return;

        const dist = Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2 + (p1.z-p2.z)**2);
        
        // [OPTIMIZED] Endrod (Axis): เป็นแท่งยาวอยู่แล้ว ไม่ต้องวาดถี่
        // วาดทุกๆ 1 บล็อกก็เห็นเป็นเส้นประที่สวยงามและดูรู้เรื่อง
        const steps = Math.ceil(dist); 
        
        for(let i=0; i<=steps; i++) {
            const t = i/steps;
            this.spawnSafe(dimension, CONFIG.PARTICLE_AXIS, {
                x: p1.x + (p2.x - p1.x) * t,
                y: p1.y + (p2.y - p1.y) * t,
                z: p1.z + (p2.z - p1.z) * t
            });
        }
    }

    static drawCurve(dimension, points, playerPos) {
        if (!points || points.length === 0) return;

        // [OPTIMIZED] Curve Sampling
        // ไม่วาดทุกจุด เพราะ previewPoints อาจจะละเอียดมาก (ทุก 0.1 บล็อก)
        // เราวาดแค่พอให้เห็นรูปร่าง (ทุกๆ 2-3 จุด)
        // และเช็คระยะทางเป็นช่วงๆ
        
        // เช็คจุดแรกก่อน ถ้าไกลมากอาจจะไม่วาดเลย (Optional)
        // if (!this.isVisible(playerPos, points[0])) return;

        // วาดทุกๆ 3 จุด (จากเดิมละเอียดมาก) = ลดภาระลง 66%
        const stride = 3; 

        for (let i = 0; i < points.length; i += stride) {
            const p = points[i];
            
            // เช็คระยะทุกๆ 10 จุด เพื่อประหยัด CPU (ไม่ต้องเช็คทุกจุด)
            if (i % 30 === 0) {
                if (!this.isVisible(playerPos, p)) continue;
            }

            this.spawnSafe(dimension, CONFIG.PARTICLE_CURVE, p);
        }
    }

    static drawBox(dimension, min, max, playerPos) {
        // เช็คระยะที่จุดกึ่งกลางกล่อง
        const center = { x: (min.x+max.x)/2, y: (min.y+max.y)/2, z: (min.z+max.z)/2 };
        if (!this.isVisible(playerPos, center)) return;

        const expand = 0.05;
        const x1 = min.x - expand, y1 = min.y - expand, z1 = min.z - expand;
        const x2 = max.x + 1 + expand, y2 = max.y + 1 + expand, z2 = max.z + 1 + expand;

        const lines = [
            [[x1,y1,z1], [x2,y1,z1]], [[x1,y1,z1], [x1,y1,z2]], 
            [[x2,y1,z1], [x2,y1,z2]], [[x1,y1,z2], [x2,y1,z2]],
            
            [[x1,y2,z1], [x2,y2,z1]], [[x1,y2,z1], [x1,y2,z2]], 
            [[x2,y2,z1], [x2,y2,z2]], [[x1,y2,z2], [x2,y2,z2]],
            
            [[x1,y1,z1], [x1,y2,z1]], [[x2,y1,z1], [x2,y2,z1]],
            [[x1,y1,z2], [x1,y2,z2]], [[x2,y1,z2], [x2,y2,z2]]
        ];

        for(let line of lines) {
            const start = {x:line[0][0], y:line[0][1], z:line[0][2]};
            const end = {x:line[1][0], y:line[1][1], z:line[1][2]};
            this.drawParticleLine(dimension, start, end);
        }
    }

    static drawParticleLine(dimension, p1, p2) {
        const dist = Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2 + (p1.z-p2.z)**2);
        
        // [OPTIMIZED] Balloon Gas (Region Box)
        // อนุภาคใหญ่มาก วาดถี่แล้วบังตาและแลค
        // ปรับเป็น 1 จุดทุกๆ 1.5 บล็อก
        
        if (dist <= 0) return;
        
        const density = 1.5; // ยิ่งมากยิ่งห่าง
        const steps = Math.ceil(dist / density);

        for(let i=0; i<=steps; i++) {
            const t = i/steps;
            this.spawnSafe(dimension, CONFIG.PARTICLE_REGION, {
                x: p1.x + (p2.x - p1.x) * t,
                y: p1.y + (p2.y - p1.y) * t,
                z: p1.z + (p2.z - p1.z) * t
            });
        }
    }
}