// scripts/session.js
import { MODES, INPUT_STATE, CONFIG } from './config.js'; 
import { 
    Vector3, 
    calculateSimpleCurvePoints, 
    calculateSpiralCurvePoints, 
    calculateS1Height, 
    calculateS2RampHeight, 
    calculateS3CrossHeight
} from './math_utils.js';
import { BlockPermutation } from '@minecraft/server';
import { HistoryManager } from './history.js';
import { placeStructureWorker } from './placement_worker.js';
import { CurveStrategies } from './curve_strategies.js';
import { getCurveFeedback } from './curve_feedback.js';

export class Session {
    constructor(player) {
        this.player = player;
        this.history = new HistoryManager();
        this.reset();
        this.currentLoaderCenter = null;
        this.isRestoring = false;
        
        this.selectedPoints = []; 
        this.insertIndex = -1;
    }

    reset() {
        this.mode = MODES.NONE;
        this.state = INPUT_STATE.IDLE;
        this.returnState = INPUT_STATE.IDLE;
        
        this.vectorStart = null;
        this.vectorEnd = null;
        this.refTangent = null;
        this.refSlope = 0;

        this.vectorGStart = null;
        this.vectorGEnd = null;
        this.refSlopeG = 0;

        this.vectorHStart = null;
        this.vectorHEnd = null;
        this.targetH = 0;

        this.vectorTSStart = null;
        this.vectorTSEnd = null;
        this.refTangentTS = null;
        this.refSlopeTS = 0;

        this.vectorRStart = null;
        this.vectorREnd = null;
        
        this.points = [];
        this.curveTypes = []; 
        
        this.previewPoints = []; 
        this.previewCumulativeDist = []; 
        this.totalLength = 0;

        this.generatedEndTangent = null;
        this.generatedEndSlope = 0;

        this.sourceP1 = null;
        this.sourceP2 = null;
        this.sourceMin = null;
        this.sourceMax = null;
        this.sourceDirection = 'z';

        this.customAxis = null; 
        this.currentLoaderCenter = null;
        this.isRestoring = false;

        this.selectedPoints = [];
        this.insertIndex = -1;
    }

    toggleSelection(pos) {
        const threshold = 1.0; 
        let found = false;
        const check = (pt, type, index = null) => {
            if (!pt) return;
            const dist = Math.sqrt((pt.x - pos.x)**2 + (pt.y - pos.y)**2 + (pt.z - pos.z)**2);
            if (dist < threshold) {
                const existingIdx = this.selectedPoints.findIndex(s => s.ref === pt);
                if (existingIdx !== -1) {
                    this.selectedPoints.splice(existingIdx, 1);
                    this.player.sendMessage(`§ePoint selection cancelled.`);
                } else {
                    this.selectedPoints.push({ type, index, ref: pt });
                    this.player.sendMessage(`§aPoint selected.`);
                }
                found = true;
                return true; 
            }
            return false;
        };
        for (let i = 0; i < this.points.length; i++) { if (check(this.points[i], 'point', i)) return; }
        if (check(this.vectorStart, 'vectorStart')) return;
        if (check(this.vectorEnd, 'vectorEnd')) return;
        if (check(this.vectorGStart, 'vectorGStart')) return;
        if (check(this.vectorGEnd, 'vectorGEnd')) return;
        if (check(this.vectorHStart, 'vectorHStart')) return;
        if (check(this.vectorHEnd, 'vectorHEnd')) return;
        if (check(this.vectorTSStart, 'vectorTSStart')) return;
        if (check(this.vectorTSEnd, 'vectorTSEnd')) return;
        if (check(this.vectorRStart, 'vectorRStart')) return;
        if (check(this.vectorREnd, 'vectorREnd')) return;
        if (check(this.customAxis, 'customAxis')) return;
    }

    clearSelection() {
        if (this.selectedPoints.length > 0) {
            this.selectedPoints = [];
            this.player.sendMessage("§eAll selections cleared.");
        }
    }

    deleteSelected() {
        if (this.selectedPoints.length === 0) {
            this.player.sendMessage("§cNo points selected.");
            return;
        }
        const hasVectorPoints = this.selectedPoints.some(s => s.type !== 'point');
        if (hasVectorPoints) {
            this.player.sendMessage("§cCannot delete vector control points (t1, g, h). Use !mov to move or !rst to reset.");
            return;
        }
        this.history.pushState(this); 
        const pointRefsToDelete = this.selectedPoints.map(s => s.ref);
        const initialLen = this.points.length;
        this.points = this.points.filter(p => !pointRefsToDelete.includes(p));
        const newSegmentCount = Math.max(0, this.points.length - 1);
        if (this.curveTypes.length > newSegmentCount) {
            this.curveTypes = this.curveTypes.slice(0, newSegmentCount);
        }
        this.player.sendMessage(`§aDeleted ${initialLen - this.points.length} points.`);
        this.selectedPoints = []; 
        this.calculatePreviewFromState();
    }

    startMove() {
        if (this.selectedPoints.length === 0) {
            this.player.sendMessage("§cPlease select points to move first.");
            return;
        }
        this.saveState();
        this.state = INPUT_STATE.MOVING_POINTS;
        this.player.sendMessage("§eMoving points... Long press on a block to place.");
    }

    executeMove(targetPos) {
        this.history.pushState(this); 
        const pivot = this.selectedPoints[0].ref; 
        const offset = {
            x: targetPos.x - pivot.x,
            y: targetPos.y - pivot.y,
            z: targetPos.z - pivot.z
        };
        let count = 0;
        for (const item of this.selectedPoints) {
            item.ref.x += offset.x;
            item.ref.y += offset.y;
            item.ref.z += offset.z;
            count++;
        }
        this.recalculateVectors();
        this.player.sendMessage(`§aMoved ${count} points successfully.`);
        this.restoreState(); 
        this.selectedPoints = []; 
        this.calculatePreviewFromState();
    }

    recalculateVectors() {
        if (this.vectorStart && this.vectorEnd) {
            const vec = this.vectorEnd.sub(this.vectorStart);
            const len = vec.horizontalLength();
            if (len > 0) {
                this.refTangent = vec.normalizeHorizontal();
                this.refSlope = vec.y / len;
            }
        }
        if (this.vectorGStart && this.vectorGEnd) {
            const vec = this.vectorGEnd.sub(this.vectorGStart);
            const len = vec.horizontalLength();
            if (len > 0) this.refSlopeG = vec.y / len;
        }
        if (this.vectorHStart && this.vectorHEnd) {
            this.targetH = this.vectorHEnd.y - this.vectorHStart.y;
        }
        if (this.vectorTSStart && this.vectorTSEnd) {
            const vec = this.vectorTSEnd.sub(this.vectorTSStart);
            const len = vec.horizontalLength();
            if (len > 0) {
                this.refTangentTS = vec.normalizeHorizontal();
                this.refSlopeTS = vec.y / len;
            }
        }
        if (this.points.length > 0 && this.refTangent) {
            this.points[0].tangent = this.refTangent;
        }
    }

    startAddPoint() {
        if (this.selectedPoints.length !== 2) {
             this.player.sendMessage("§cMust select 2 consecutive points (Pn and Pn+1).");
             return;
        }
        const pts = this.selectedPoints.filter(s => s.type === 'point').sort((a,b) => a.index - b.index);
        if (pts.length !== 2 || pts[1].index - pts[0].index !== 1) {
             this.player.sendMessage("§cMust select 2 consecutive points only.");
             return;
        }
        this.saveState();
        this.insertIndex = pts[0].index; 
        this.state = INPUT_STATE.ADDING_POINT;
        this.player.sendMessage("§e[Add Point] Long press to insert a new point.");
    }

    executeAddPoint(pos) {
        if (this.insertIndex >= 0 && this.insertIndex < this.points.length) {
            if (this.isSameLocation(pos, this.points[this.insertIndex])) {
                this.player.sendMessage("§cNew point must not overlap with the previous point.");
                return;
            }
            if (this.insertIndex + 1 < this.points.length) {
                if (this.isSameLocation(pos, this.points[this.insertIndex + 1])) {
                    this.player.sendMessage("§cNew point must not overlap with the next point.");
                    return;
                }
            }
        }

        this.history.pushState(this);
        this.points.splice(this.insertIndex + 1, 0, pos);
        const oldType = this.curveTypes[this.insertIndex];
        this.curveTypes.splice(this.insertIndex, 0, oldType);
        this.player.sendMessage(`§aPoint added at P${this.insertIndex + 2}.`);
        this.restoreState(); 
        this.selectedPoints = []; 
        this.insertIndex = -1;
        this.calculatePreviewFromState();
    }

    isSameLocation(p1, p2) {
        if (!p1 || !p2) return false;
        return p1.sub(p2).length() < 0.1;
    }

    softReset() {
        this.history.pushState(this);
        this.vectorStart = null;
        this.vectorEnd = null;
        this.refTangent = null;
        this.refSlope = 0;
        this.vectorGStart = null;
        this.vectorGEnd = null;
        this.refSlopeG = 0;
        this.vectorHStart = null;
        this.vectorHEnd = null;
        this.targetH = 0;
        this.vectorTSStart = null;
        this.vectorTSEnd = null;
        this.refTangentTS = null;
        this.refSlopeTS = 0;
        this.vectorRStart = null;
        this.vectorREnd = null;
        this.points = [];
        this.curveTypes = []; 
        this.previewPoints = []; 
        this.previewCumulativeDist = []; 
        this.totalLength = 0;
        this.generatedEndTangent = null;
        this.generatedEndSlope = 0;
        this.selectedPoints = []; 
        this.insertIndex = -1;

        if (this.mode === MODES.MODE_A || 
            this.mode === MODES.MODE_A1 || 
            this.mode === MODES.MODE_A2 || 
            this.mode === MODES.MODE_B || 
            this.mode === MODES.MODE_B1 || 
            this.mode === MODES.MODE_B2) {
            this.state = INPUT_STATE.SELECTING_VECTOR_START;
            this.player.sendMessage("§e[Reset] Data cleared. Please start defining vector t1.");
        } else if (this.mode === MODES.MODE_C) {
            this.state = INPUT_STATE.SELECTING_VECTOR_R_START;
            this.player.sendMessage("§e[Reset] Data cleared. Please define the Center point.");
        } else {
            this.state = INPUT_STATE.IDLE;
            this.player.sendMessage("§e[Reset] All data cleared.");
        }
    }

    serializeState() {
        const cloneVec = (v) => v ? new Vector3(v.x, v.y, v.z) : null;
        return {
            mode: this.mode,
            state: this.state,
            returnState: this.returnState,
            vectorStart: cloneVec(this.vectorStart),
            vectorEnd: cloneVec(this.vectorEnd),
            refTangent: cloneVec(this.refTangent),
            refSlope: this.refSlope,
            vectorGStart: cloneVec(this.vectorGStart),
            vectorGEnd: cloneVec(this.vectorGEnd),
            refSlopeG: this.refSlopeG,
            vectorHStart: cloneVec(this.vectorHStart),
            vectorHEnd: cloneVec(this.vectorHEnd),
            targetH: this.targetH,
            vectorTSStart: cloneVec(this.vectorTSStart),
            vectorTSEnd: cloneVec(this.vectorTSEnd),
            refTangentTS: cloneVec(this.refTangentTS),
            refSlopeTS: this.refSlopeTS,
            vectorRStart: cloneVec(this.vectorRStart),
            vectorREnd: cloneVec(this.vectorREnd),
            points: this.points.map(p => new Vector3(p.x, p.y, p.z)), 
            curveTypes: [...this.curveTypes],
            generatedEndTangent: cloneVec(this.generatedEndTangent),
            generatedEndSlope: this.generatedEndSlope
        };
    }

    deserializeState(data) {
        Object.assign(this, data);
        this.selectedPoints = []; 
        this.insertIndex = -1;
        this.recalculateVectors(); 
    }

    calculatePreviewFromState() {
        this.isRestoring = true; 
        this.previewPoints = [];
        this.previewCumulativeDist = [];
        this.totalLength = 0;
        try {
            if (this.mode === MODES.MODE_C && this.vectorRStart && this.vectorREnd) {
                this.calculateCurve('cir');
            } else if (this.points.length >= 2 && this.curveTypes.length > 0) {
                this.calculateCurve(this.curveTypes[this.curveTypes.length-1]);
            } else if ((this.mode === MODES.MODE_B || this.mode === MODES.MODE_B1 || this.mode === MODES.MODE_B2) && this.points.length >= 1 && this.curveTypes.length > 0) {
                 this.calculateCurve(this.curveTypes[0]); 
            }
        } catch (e) { }
        this.isRestoring = false;
    }

    startRealtimePoint() {
        if (this.mode !== MODES.MODE_A && this.mode !== MODES.MODE_A1 && this.mode !== MODES.MODE_A2) {
             this.player.sendMessage("§cCommand !pos is available in Mode A, A1, A2 only.");
             return;
        }
        if (!this.vectorStart || !this.vectorEnd) {
            this.player.sendMessage("§cPlease define t1 first.");
            return;
        }
        this.history.pushState(this);
        const pos = Vector3.fromObject(this.player.location);
        this.points.push(pos);
        this.state = INPUT_STATE.PLACING_REALTIME_POINT;
        this.player.sendMessage(`§e[Real-time] Point P${this.points.length} is following you...`);
        this.player.sendMessage("§eUse Selector Wand (Long Press) to place.");
    }

    updateRealtimePoint(playerPos) {
        if (this.points.length === 0) return;
        const idx = this.points.length - 1;
        this.points[idx] = new Vector3(playerPos.x, playerPos.y, playerPos.z);
        this.calculatePreviewFromState();
    }

    finalizeRealtimePoint(targetPos) {
        if (this.points.length === 0) return;
        const idx = this.points.length - 1;
        this.points[idx] = targetPos;
        this.player.sendMessage(`§aPoint P${this.points.length} placed at ${Math.floor(targetPos.x)}, ${Math.floor(targetPos.y)}, ${Math.floor(targetPos.z)}`);
        this.state = INPUT_STATE.SELECTING_POINTS;
        this.calculatePreviewFromState();
    }

    saveState() {
        if (this.state !== INPUT_STATE.IDLE && 
            this.state !== INPUT_STATE.SELECTING_REGION_P1 && 
            this.state !== INPUT_STATE.SELECTING_REGION_P2 && 
            this.state !== INPUT_STATE.SELECTING_AXIS_POINT && 
            this.state !== INPUT_STATE.MOVING_POINTS && 
            this.state !== INPUT_STATE.ADDING_POINT &&
            this.state !== INPUT_STATE.PLACING_REALTIME_POINT) {
            this.returnState = this.state;
        }
    }

    restoreState() {
        this.state = this.returnState;
        if (this.state !== INPUT_STATE.IDLE) {
            this.player.sendMessage("§e(Returned to previous step...)");
        }
    }

    addPoint(pos) {
        if (this.state === INPUT_STATE.MOVING_POINTS) {
            this.executeMove(pos);
            return;
        }
        if (this.state === INPUT_STATE.ADDING_POINT) {
            this.executeAddPoint(pos);
            return;
        }
        if (this.state === INPUT_STATE.PLACING_REALTIME_POINT) {
            this.finalizeRealtimePoint(pos);
            return;
        }

        const isRegionOrAxis = (
            this.state === INPUT_STATE.SELECTING_REGION_P1 ||
            this.state === INPUT_STATE.SELECTING_REGION_P2 ||
            this.state === INPUT_STATE.SELECTING_AXIS_POINT
        );
        
        if (!isRegionOrAxis && !this.isRestoring) {
             this.history.pushState(this);
        }

        if (this.state === INPUT_STATE.SELECTING_AXIS_POINT) {
            const p = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
            const min = this.sourceMin;
            const max = this.sourceMax;

            if (p.x >= min.x && p.x <= max.x &&
                p.y >= min.y && p.y <= max.y &&
                p.z >= min.z && p.z <= max.z) {
                
                this.customAxis = pos;
                this.player.sendMessage(`§aPivot Axis defined at ${p.x}, ${p.y}, ${p.z}`);
                this.restoreState(); 
            } else {
                this.player.sendMessage(`§cSelected point is outside the Region. Please try again.`);
            }
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_R_START) {
            this.vectorRStart = pos;
            this.state = INPUT_STATE.SELECTING_VECTOR_R_END;
            this.player.sendMessage("§aCenter defined. Now select Radius point (Edge).");
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_R_END) {
            if (this.isSameLocation(pos, this.vectorRStart)) {
                this.player.sendMessage("§cRadius point must not be the same as Center.");
                return;
            }
            this.vectorREnd = pos;
            const dy = Math.abs(this.vectorREnd.y - this.vectorRStart.y);
            if (dy > 0.5) this.player.sendMessage("§eWarning: Radius vector has elevation difference (System uses flat 2D distance).");
            this.player.sendMessage("§aRadius defined.");
            this.player.sendMessage("§eUse command !c cir to create the circle.");
            this.state = INPUT_STATE.IDLE; 
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_START) {
            this.vectorStart = pos;
            this.state = INPUT_STATE.SELECTING_VECTOR_END;
            this.player.sendMessage("§aStart of t1 defined. Now select the End of t1.");
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_END) {
            if (this.isSameLocation(pos, this.vectorStart)) {
                this.player.sendMessage("§cEnd of t1 must not be the same as Start.");
                return;
            }
            this.vectorEnd = pos;
            const vec = this.vectorEnd.sub(this.vectorStart);
            const horizLen = vec.horizontalLength();
            if (horizLen === 0) {
                this.player.sendMessage("§cHorizontal vector cannot be 0.");
                this.state = INPUT_STATE.SELECTING_VECTOR_START;
                return;
            }
            this.refTangent = vec.normalizeHorizontal();
            this.refSlope = vec.y / horizLen;
            if (this.mode === MODES.MODE_A1 || this.mode === MODES.MODE_A2) {
                this.state = INPUT_STATE.SELECTING_VECTOR_G_START;
                this.player.sendMessage(`§at1 saved (Slope: ${this.refSlope.toFixed(3)})`);
                this.player.sendMessage("§eNext: Select start of vector g (Ref Slope).");
            } else if (this.mode === MODES.MODE_B || this.mode === MODES.MODE_B1 || this.mode === MODES.MODE_B2) {
                this.state = INPUT_STATE.SELECTING_VECTOR_TS_START;
                this.player.sendMessage(`§at1 saved (Slope: ${this.refSlope.toFixed(3)})`);
                this.player.sendMessage("§eNext: Select start of vector ts (Target Direction).");
            } else {
                this.state = INPUT_STATE.SELECTING_POINTS;
                this.player.sendMessage(`§at1 saved (Slope: ${this.refSlope.toFixed(3)})`);
                this.player.sendMessage("§eNow select Point P1 (Curve Start).");
            }
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_G_START) {
            this.vectorGStart = pos;
            this.state = INPUT_STATE.SELECTING_VECTOR_G_END;
            this.player.sendMessage("§aStart of g defined. Now select End of g.");
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_G_END) {
            if (this.isSameLocation(pos, this.vectorGStart)) {
                this.player.sendMessage("§cEnd of g must not be the same as Start.");
                return;
            }
            this.vectorGEnd = pos;
            const vec = this.vectorGEnd.sub(this.vectorGStart);
            const horizLen = vec.horizontalLength();
            if (horizLen === 0) {
                this.player.sendMessage("§cHorizontal vector g cannot be 0.");
                this.state = INPUT_STATE.SELECTING_VECTOR_G_START;
                return;
            }
            this.refSlopeG = vec.y / horizLen;
            if (this.mode === MODES.MODE_A2) {
                this.state = INPUT_STATE.SELECTING_VECTOR_H_START;
                this.player.sendMessage(`§ag saved (Slope: ${this.refSlopeG.toFixed(3)})`);
                this.player.sendMessage("§eNext: Select start of vector h (Peak Height).");
            } else {
                this.state = INPUT_STATE.SELECTING_POINTS;
                this.player.sendMessage(`§ag saved (Slope: ${this.refSlopeG.toFixed(3)})`);
                this.player.sendMessage("§eNow select Point P1.");
            }
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_H_START) {
            this.vectorHStart = pos;
            this.state = INPUT_STATE.SELECTING_VECTOR_H_END;
            this.player.sendMessage("§aStart of h defined. Now select End of h.");
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_H_END) {
            if (this.isSameLocation(pos, this.vectorHStart)) {
                this.player.sendMessage("§cEnd of h must not be the same as Start.");
                return;
            }
            this.vectorHEnd = pos;
            this.targetH = this.vectorHEnd.y - this.vectorHStart.y;
            if (this.mode === MODES.MODE_B2) {
                this.state = INPUT_STATE.SELECTING_POINT_S;
                this.player.sendMessage(`§ah saved (Height: ${this.targetH.toFixed(2)})`);
                this.player.sendMessage("§eNow select Point S (Start of Curve).");
            } else {
                this.state = INPUT_STATE.SELECTING_POINTS;
                this.player.sendMessage(`§ah saved (Height: ${this.targetH.toFixed(2)})`);
                this.player.sendMessage("§eNow select Point P1.");
            }
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_TS_START) {
            this.vectorTSStart = pos;
            this.state = INPUT_STATE.SELECTING_VECTOR_TS_END;
            this.player.sendMessage("§aStart of ts defined. Now select End of ts.");
        } else if (this.state === INPUT_STATE.SELECTING_VECTOR_TS_END) {
            if (this.isSameLocation(pos, this.vectorTSStart)) {
                this.player.sendMessage("§cEnd of ts must not be the same as Start.");
                return;
            }
            this.vectorTSEnd = pos;
            const vec = this.vectorTSEnd.sub(this.vectorTSStart);
            const horizLen = vec.horizontalLength();
            if (horizLen === 0) {
                this.player.sendMessage("§cHorizontal vector ts cannot be 0.");
                this.state = INPUT_STATE.SELECTING_VECTOR_TS_START;
                return;
            }
            this.refTangentTS = vec.normalizeHorizontal();
            this.refSlopeTS = vec.y / horizLen;
            
            if (this.mode === MODES.MODE_B2) {
                this.state = INPUT_STATE.SELECTING_VECTOR_H_START;
                this.player.sendMessage(`§ats saved (Slope: ${this.refSlopeTS.toFixed(3)})`);
                this.player.sendMessage("§eNext: Select start of vector h (Peak Height).");
            } else {
                this.state = INPUT_STATE.SELECTING_POINT_S; 
                this.player.sendMessage(`§ats saved (Slope: ${this.refSlopeTS.toFixed(3)})`);
                this.player.sendMessage("§eNow select Point S (Start of Curve).");
            }

        } else if (this.state === INPUT_STATE.SELECTING_POINTS) {
            if (this.points.length > 0 && this.isSameLocation(pos, this.points[this.points.length - 1])) {
                this.player.sendMessage("§cPn must not be the same as Pn-1.");
                return;
            }
            this.points.push(pos);
            this.player.sendMessage(`§aPoint P${this.points.length} added.`);
            if (this.points.length >= 2) {
                this.player.sendMessage("§eUse !c sim or !c spi to generate curve.");
            }
        } else if (this.state === INPUT_STATE.SELECTING_POINT_S) {
            this.points = [pos]; 
            this.player.sendMessage(`§aPoint S defined at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`);
            this.player.sendMessage("§eUse !c [sim/spi/cwt/rrr] to generate curve.");
        } else if (this.state === INPUT_STATE.SELECTING_REGION_P1) {
            this.sourceP1 = pos;
            this.sourceP2 = null;
            this.sourceMin = null;
            this.sourceMax = null;
            this.customAxis = null; 
            this.state = INPUT_STATE.SELECTING_REGION_P2;
            this.player.sendMessage("§aFirst corner defined. Now select the opposite diagonal corner.");
        } else if (this.state === INPUT_STATE.SELECTING_REGION_P2) {
            this.sourceP2 = pos;
            this.calculateSourceBounds();
            this.player.sendMessage(`§aRegion selected successfully! (Size: ${this.sourceMax.x - this.sourceMin.x + 1}x${this.sourceMax.y - this.sourceMin.y + 1}x${this.sourceMax.z - this.sourceMin.z + 1})`);
            this.player.sendMessage("§eUse command !set [a/b/c] to place the Region along the curve.");
            this.restoreState();
        }
    }

    calculateSourceBounds() {
        if (!this.sourceP1 || !this.sourceP2) return;
        const p1 = { x: Math.floor(this.sourceP1.x), y: Math.floor(this.sourceP1.y), z: Math.floor(this.sourceP1.z) };
        const p2 = { x: Math.floor(this.sourceP2.x), y: Math.floor(this.sourceP2.y), z: Math.floor(this.sourceP2.z) };
        this.sourceMin = new Vector3(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.min(p1.z, p2.z));
        this.sourceMax = new Vector3(Math.max(p1.x, p2.x), Math.max(p1.y, p2.y), Math.max(p1.z, p2.z));
    }

    calculateCurve(type) {
        if (!this.isRestoring) {
            this.history.pushState(this);
        }
        
        this.generatedEndTangent = null;

        if (!this.isRestoring && this.selectedPoints.length === 2) {
            const pts = this.selectedPoints.filter(s => s.type === 'point').sort((a,b) => a.index - b.index);
            if (pts.length === 2 && pts[1].index - pts[0].index === 1) {
                const segIdx = pts[0].index;
                if (this.curveTypes[segIdx] !== undefined) {
                    this.curveTypes[segIdx] = type;
                    this.player.sendMessage(`§aUpdated segment ${segIdx+1} to ${type.toUpperCase()}`);
                    this.calculatePreviewFromState(); 
                    this.selectedPoints = []; 
                    return;
                }
            }
        }

        if (this.mode === MODES.MODE_C) {
            if (type !== 'cir') {
                this.player.sendMessage("§cMode C only supports !c cir.");
                return;
            }
            if (!this.vectorRStart || !this.vectorREnd) {
                this.player.sendMessage("§cMust define radius (vector r) first.");
                return;
            }

            const result = CurveStrategies.calculateModeC(this.vectorRStart, this.vectorREnd);
            if (!result) {
                this.player.sendMessage("§cRadius is too small.");
                return;
            }

            this.previewPoints = result.points;
            this.totalLength = result.totalLength;
            
            this.previewCumulativeDist = [0];
            let acc = 0;
            for(let i=1; i<this.previewPoints.length; i++) {
                acc += this.previewPoints[i].sub(this.previewPoints[i-1]).length();
                this.previewCumulativeDist.push(acc);
            }

            if (!this.isRestoring) {
                const feedback = getCurveFeedback(this.mode, result.stats);
                this.player.sendMessage(feedback);
            }
            return;
        }

        const isModeB = (this.mode === MODES.MODE_B || this.mode === MODES.MODE_B1 || this.mode === MODES.MODE_B2);
        if (!isModeB && this.points.length < 2) {
            this.player.sendMessage("§cMust have at least 2 points (P1, P2).");
            return;
        }
        if (isModeB && this.points.length < 1) {
            this.player.sendMessage("§cMust define Point S first.");
            return;
        }

        if (isModeB) {
            if (!this.isRestoring) {
                if (this.curveTypes.length === 0) this.curveTypes.push(type);
                else this.curveTypes[0] = type;
            }

            const result = CurveStrategies.calculateModeB(this, type);
            if (!result) {
                this.player.sendMessage("§cCurve too short or angle not supported.");
                return;
            }

            this.previewPoints = result.points;
            this.previewCumulativeDist = result.cumulativeDist;
            this.totalLength = result.totalLength;

            if (!this.isRestoring) {
                const feedback = getCurveFeedback(this.mode, result.stats);
                this.player.sendMessage(feedback);
            }
            return;
        }

        const segmentCount = this.points.length - 1;
        if (!this.isRestoring) {
            while(this.curveTypes.length < segmentCount) {
                this.curveTypes.push(type); 
            }
            this.curveTypes[segmentCount - 1] = type; 
        }
        this.previewPoints = [];
        this.previewCumulativeDist = [];
        this.totalLength = 0;
        let currentTan = this.refTangent;
        let currentSlope = this.refSlope; 
        const startPoint = this.points[0];
        startPoint.tangent = this.refTangent;
        let allCurvePoints = [];
        allCurvePoints.push(startPoint);
        let cumulativeDistances = [0];
        const calcLimit = this.isRestoring ? Math.min(segmentCount, this.curveTypes.length) : segmentCount;
        
        let lastSegmentStats = null;
        let lastSegmentHorizontalStats = null; 

        for (let i = 0; i < calcLimit; i++) {
            const pStart = this.points[i];
            const pEnd = this.points[i+1];
            const segType = this.curveTypes[i];
            let horizResult;
            
            const startSlopeForStat = currentSlope;

            if (segType === 'spi') {
                horizResult = calculateSpiralCurvePoints(pStart, pEnd, currentTan);
            } else {
                horizResult = calculateSimpleCurvePoints(pStart, pEnd, currentTan); 
            }
            if (horizResult.points.length === 0) continue;

            if (!this.isRestoring) {
                const dx = pEnd.x - pStart.x;
                const dz = pEnd.z - pStart.z;
                const chordAngle = Math.atan2(dz, dx);
                const tanAngle = Math.atan2(currentTan.z, currentTan.x);
                let diff = chordAngle - tanAngle;
                while (diff <= -Math.PI) diff += 2 * Math.PI;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                const theta = Math.abs(diff) * 2;
                let R = Infinity;
                if (theta > 0.001) {
                     const chord = Math.sqrt(dx*dx + dz*dz);
                     R = (chord / 2) / Math.sin(theta / 2);
                }
                lastSegmentHorizontalStats = {
                    type: segType,
                    R: R,
                    A: theta * 180 / Math.PI,
                    L: horizResult.arcLength
                };
            }

            const segPoints = horizResult.points;
            if (this.mode === MODES.MODE_A) {
                let localDists = [0];
                let localTotal = 0;
                for(let j=1; j<segPoints.length; j++) {
                    const d = segPoints[j].sub(segPoints[j-1]).horizontalLength();
                    localTotal += d;
                    localDists.push(localTotal);
                }
                const vertResult = calculateS1Height(pStart, pEnd, currentSlope, localDists);
                for(let j=1; j<segPoints.length; j++) {
                    segPoints[j].y = vertResult.heights[j];
                    allCurvePoints.push(segPoints[j]);
                    const distFromPrev = segPoints[j].sub(allCurvePoints[allCurvePoints.length-2]).length();
                    this.totalLength += distFromPrev;
                    cumulativeDistances.push(this.totalLength);
                }
                
                if (!this.isRestoring && lastSegmentHorizontalStats) {
                    lastSegmentStats = {
                        ...lastSegmentHorizontalStats,
                        h: pEnd.y - pStart.y,
                        g1: startSlopeForStat,
                        g2: vertResult.endSlope
                    };
                }

                currentSlope = vertResult.endSlope;
            } 
            else {
                for(let j=1; j<segPoints.length; j++) {
                    allCurvePoints.push(segPoints[j]);
                    const hDist = segPoints[j].sub(allCurvePoints[allCurvePoints.length-2]).horizontalLength();
                    const prevDist = cumulativeDistances[cumulativeDistances.length-1];
                    cumulativeDistances.push(prevDist + hDist);
                }
            }
            currentTan = horizResult.endTan;
        }
        if ((this.mode === MODES.MODE_A1 || this.mode === MODES.MODE_A2) && allCurvePoints.length > 0) {
            const pStart = this.points[0];
            const pEnd = this.points[this.points.length - 1]; 
            let rampHeights;
            if (this.mode === MODES.MODE_A1) {
                rampHeights = calculateS2RampHeight(
                    pStart.y, pEnd.y, this.refSlope, this.refSlopeG, cumulativeDistances
                );

                if (!this.isRestoring && lastSegmentHorizontalStats) {
                     const L_total = cumulativeDistances[cumulativeDistances.length - 1];
                     const dy_total = pEnd.y - pStart.y;
                     const m1 = this.refSlope;
                     const m2 = this.refSlopeG;
                     const s = (dy_total * dy_total) / L_total; 
                     const expS = Math.exp(-s / 2);
                     const lp = (expS + 1) * L_total / 4;
                     const lt = (2 - 2 * expS) * L_total / 4;
                     const mt = (dy_total - 0.5 * lp * (m1 + m2)) / (lp + lt);

                     lastSegmentStats = {
                        ...lastSegmentHorizontalStats,
                        h: dy_total,
                        g1: m1,
                        g2: m2,
                        gT: mt
                    };
                }

            } else if (this.mode === MODES.MODE_A2) {
                rampHeights = calculateS3CrossHeight(
                    pStart.y, pEnd.y, this.refSlope, this.refSlopeG, this.targetH, cumulativeDistances
                );

                // [Validation Feedback for A2 - English]
                const dy_total = pEnd.y - pStart.y;
                if (!this.isRestoring) {
                    if (this.targetH > 0 && dy_total > this.targetH) {
                        this.player.sendMessage(`§c[Warning] End height (${dy_total.toFixed(2)}) is higher than peak h (${this.targetH.toFixed(2)}).`);
                    } else if (this.targetH < 0 && dy_total < this.targetH) {
                        this.player.sendMessage(`§c[Warning] End height (${dy_total.toFixed(2)}) is lower than min h (${this.targetH.toFixed(2)}).`);
                    }
                }

                if (!this.isRestoring && lastSegmentHorizontalStats) {
                     const L_total = cumulativeDistances[cumulativeDistances.length - 1];
                     const m1 = this.refSlope;
                     const m2 = this.refSlopeG;
                     const targetH = this.targetH;
                     
                     const userH = Math.abs(targetH);
                     const k = Math.exp(-((2 * userH * userH) / L_total) / 2);
                     const L_li = (14 + 16*k) * L_total / 105;
                     const L_ti = (21 - 21*k) * L_total / 105;
                     const L_c = (35 + 10*k) * L_total / 105;
                     const L_to = L_ti;
                     const L_lo = L_li;
                     
                     const KA = L_li/2 + L_ti + L_c/2;
                     const KB = L_c/2 + L_to + L_lo/2;
                     const RHS1 = dy_total - (m1 * L_li/2) - (m2 * L_lo/2);
                     const KC = L_li/2 + L_ti + (3*L_c/8);
                     const KD = L_c/8;
                     const RHS2 = targetH - (m1 * L_li / 2);
                     
                     const Det = KA * KD - KB * KC;
                     let min = 0, mout = 0;
                     if (Math.abs(Det) > 1e-9) {
                        min = (RHS1 * KD - RHS2 * KB) / Det;
                        mout = (KA * RHS2 - KC * RHS1) / Det;
                     }

                     lastSegmentStats = {
                        ...lastSegmentHorizontalStats,
                        h: targetH, 
                        g1: m1,
                        g2: m2,
                        gT1: min,
                        gT2: mout
                    };
                }
            }
            this.totalLength = 0; 
            this.previewCumulativeDist = [0];
            for(let i=0; i<allCurvePoints.length; i++) {
                allCurvePoints[i].y = rampHeights[i];
                if (i > 0) {
                    const dist3D = allCurvePoints[i].sub(allCurvePoints[i-1]).length();
                    this.totalLength += dist3D;
                    this.previewCumulativeDist.push(this.totalLength);
                }
            }
        } else {
            this.previewCumulativeDist = cumulativeDistances;
        }
        this.previewPoints = allCurvePoints;
        
        if (!this.isRestoring) {
            if (lastSegmentStats) {
                const msg = getCurveFeedback(this.mode, lastSegmentStats);
                this.player.sendMessage(msg);
            } else {
                this.player.sendMessage(`§aCurve calculation complete. (Seg ${segmentCount}: ${type.toUpperCase()})`);
            }
        }

        if (this.mode === MODES.MODE_A || this.mode === MODES.MODE_A1 || this.mode === MODES.MODE_A2) {
            if (this.previewPoints.length > 0) {
                this.generatedEndTangent = currentTan;
                if (this.mode === MODES.MODE_A) {
                    this.generatedEndSlope = currentSlope;
                } else {
                    this.generatedEndSlope = this.refSlopeG; 
                }
            }
        }
    }

    getCurveStateAtDistance(targetDist) {
        targetDist = Math.max(0, Math.min(targetDist, this.totalLength));
        let idx = 0;
        while(idx < this.previewCumulativeDist.length - 1 && this.previewCumulativeDist[idx+1] < targetDist) {
            idx++;
        }
        const p1 = this.previewPoints[idx];
        const p2 = this.previewPoints[idx+1];
        if (!p2) return { pos: p1, tan: p1.tangent || new Vector3(1,0,0) };
        const d1 = this.previewCumulativeDist[idx];
        const d2 = this.previewCumulativeDist[idx+1];
        const diff = d2 - d1;
        const t = (diff < 0.00001) ? 0 : (targetDist - d1) / diff;
        const pos = Vector3.lerp(p1, p2, t);
        const tan1 = p1.tangent || new Vector3(1,0,0);
        const tan2 = p2.tangent || new Vector3(1,0,0);
        const tan = Vector3.lerp(tan1, tan2, t).normalize();
        return { pos, tan };
    }

    *moveLoader(dimension, x, y, z) {
        try { dimension.runCommand(`tickingarea remove ${CONFIG.LOADER_ID}`); } catch (e) {}
        yield; 
        try {
            const bx = Math.floor(x);
            const by = Math.floor(y);
            const bz = Math.floor(z);
            dimension.runCommand(`tickingarea add circle ${bx} ${by} ${bz} 4 ${CONFIG.LOADER_ID}`);
            this.currentLoaderCenter = { x: bx, y: by, z: bz };
        } catch(e) {
            try { dimension.runCommand(`tickingarea remove_all`); } catch(err){}
            const bx = Math.floor(x);
            const by = Math.floor(y);
            const bz = Math.floor(z);
            try { dimension.runCommand(`tickingarea add circle ${bx} ${by} ${bz} 4 ${CONFIG.LOADER_ID}`); 
            this.currentLoaderCenter = { x: bx, y: by, z: bz };
            } catch(err) {}
        }
        for(let i=0; i<10; i++) yield;
    }

    *getStrictBlock(dimension, x, y, z) {
        if (this.currentLoaderCenter) {
            const dist = Math.sqrt((x - this.currentLoaderCenter.x)**2 + (z - this.currentLoaderCenter.z)**2);
            if (dist > 32) {
                yield* this.moveLoader(dimension, x, y, z);
            }
        } else {
            yield* this.moveLoader(dimension, x, y, z);
        }
        let block;
        let retryCount = 0;
        while (true) {
            try {
                block = dimension.getBlock({x, y, z});
                if (block) return block;
            } catch (e) {}
            if (retryCount % 5 === 0) { 
               yield* this.moveLoader(dimension, x, y, z);
            }
            retryCount++;
            yield; 
            if (retryCount > 100) return null; 
        }
    }

    *placeStructureJob(setMode = 'a') {
        if (this.previewPoints.length === 0) return;
        yield* placeStructureWorker(this, setMode);
    }
}