// scripts/main.js
import { world, system, BlockPermutation } from "@minecraft/server";
import { CONFIG, MODES, INPUT_STATE } from './config.js';
import { Session } from './session.js';
import { Renderer } from './renderer.js';
import { Vector3 } from './math_utils.js';

const sessions = new Map();
let activeJob = null;

function getSession(player) {
    if (!sessions.has(player.id)) {
        sessions.set(player.id, new Session(player));
    }
    return sessions.get(player.id);
}

function getCardinalDirection(viewVec) {
    const x = viewVec.x;
    const z = viewVec.z;
    if (Math.abs(x) > Math.abs(z)) return x > 0 ? "+x" : "-x";
    else return z > 0 ? "+z" : "-z";
}

world.beforeEvents.chatSend.subscribe((event) => {
    const msg = event.message.trim();
    if (!msg.startsWith("!")) return;

    const player = event.sender;
    if (!player.hasTag(CONFIG.REQUIRED_TAG)) return;

    event.cancel = true;
    const args = msg.slice(1).split(" ");
    const cmd = args[0].toLowerCase();
    const session = getSession(player);

    system.run(() => {
        if (cmd === 'add') {
            if (session.mode === MODES.MODE_A || session.mode === MODES.MODE_A1 || session.mode === MODES.MODE_A2) {
                session.startAddPoint();
            } else {
                player.sendMessage("§c!add is only available in Mode A/A1/A2.");
            }
            return;
        }

        if (cmd === 'del') {
            session.deleteSelected();
            return;
        }
        if (cmd === 'mov') {
            session.startMove();
            return;
        }
        if (cmd === 'und') {
            const steps = args[1] ? parseInt(args[1]) : 1;
            if (isNaN(steps) || steps < 1) {
                 player.sendMessage("§cUsage: !und [1-10]");
                 return;
            }
            const actualSteps = Math.min(steps, 10);
            activeJob = session.history.undo(session, actualSteps);
            return;
        }
        if (cmd === 'red') {
            const steps = args[1] ? parseInt(args[1]) : 1;
            if (isNaN(steps) || steps < 1) {
                 player.sendMessage("§cUsage: !red [1-10]");
                 return;
            }
            const actualSteps = Math.min(steps, 10);
            activeJob = session.history.redo(session, actualSteps);
            return;
        }
        if (cmd === 'rst') {
            session.softReset();
            return;
        }
        if (cmd === 'pos') {
            session.startRealtimePoint();
            return;
        }

        switch (cmd) {
            case "mode":
                session.reset();
                if (args[1] === "a") {
                    session.mode = MODES.MODE_A;
                    session.state = INPUT_STATE.SELECTING_VECTOR_START;
                    player.sendMessage("§eMode A: Start selecting t1.");
                } else if (args[1] === "a1") {
                    session.mode = MODES.MODE_A1;
                    session.state = INPUT_STATE.SELECTING_VECTOR_START;
                    player.sendMessage("§eMode A1: Start selecting t1.");
                } else if (args[1] === "a2") { 
                    session.mode = MODES.MODE_A2;
                    session.state = INPUT_STATE.SELECTING_VECTOR_START;
                    player.sendMessage("§eMode A2: Start selecting t1.");
                } else if (args[1] === "b") {
                    session.mode = MODES.MODE_B;
                    session.state = INPUT_STATE.SELECTING_VECTOR_START;
                    player.sendMessage("§eMode B: Start selecting t1 (Vertical: S1).");
                } else if (args[1] === "b1") {
                    session.mode = MODES.MODE_B1;
                    session.state = INPUT_STATE.SELECTING_VECTOR_START;
                    player.sendMessage("§eMode B1: Start selecting t1.");
                } else if (args[1] === "b2") {
                    session.mode = MODES.MODE_B2;
                    session.state = INPUT_STATE.SELECTING_VECTOR_START;
                    player.sendMessage("§eMode B2: Start selecting t1.");
                } else if (args[1] === "c") {
                    session.mode = MODES.MODE_C;
                    session.state = INPUT_STATE.SELECTING_VECTOR_R_START;
                    player.sendMessage("§eMode C (Circle): Select Center point.");
                } else {
                    player.sendMessage("§cUsage: !mode [a/a1/a2/b/b1/b2/c]");
                }
                break;

            case "c":
                if (session.mode === MODES.NONE) {
                    player.sendMessage("§cPlease select a Mode first.");
                    return;
                }
                if (args[1] === "sim") {
                    session.calculateCurve('sim');
                } else if (args[1] === "spi") {
                    session.calculateCurve('spi');
                } else if (args[1] === "cwt") {
                    if (session.mode === MODES.MODE_B || session.mode === MODES.MODE_B1 || session.mode === MODES.MODE_B2) 
                        session.calculateCurve('cwt');
                    else player.sendMessage("§c!c cwt is only available in Mode B/B1/B2.");
                } else if (args[1] === "rrr") {
                    if (session.mode === MODES.MODE_B || session.mode === MODES.MODE_B1 || session.mode === MODES.MODE_B2) 
                        session.calculateCurve('rrr');
                    else player.sendMessage("§c!c rrr is only available in Mode B/B1/B2.");
                } else if (args[1] === "cir") { 
                    if (session.mode === MODES.MODE_C) session.calculateCurve('cir');
                    else player.sendMessage("§c!c cir is only available in Mode C.");
                } else {
                    player.sendMessage("§cUsage: !c [sim/spi/cwt/rrr/cir]");
                }
                break;
            
            case "cax":
                if (!session.sourceMin || !session.sourceMax) {
                    player.sendMessage("§cPlease select a Region first (!sct).");
                    return;
                }
                session.saveState();
                session.state = INPUT_STATE.SELECTING_AXIS_POINT;
                player.sendMessage("§eLong press a block in the Region to set Pivot Axis.");
                break;

            case "sct": 
                session.saveState();
                const viewDir = player.getViewDirection();
                const dir = getCardinalDirection(viewDir);
                session.sourceDirection = dir;
                session.state = INPUT_STATE.SELECTING_REGION_P1;
                player.sendMessage(`§eStart selecting Region (Dir: ${dir}).`);
                break;

            case "set":
                if (session.previewPoints.length === 0) {
                    player.sendMessage("§cNo preview curve.");
                    return;
                }
                if (!session.sourceMin || !session.sourceMax) {
                    player.sendMessage("§cRegion not selected (!sct).");
                    return;
                }
                let setMode = 'a';
                if (args[1] && ['a', 'b', 'c'].includes(args[1].toLowerCase())) {
                    setMode = args[1].toLowerCase();
                }
                let desc = "All (Overwrite)";
                if (setMode === 'b') desc = "Fill Air";
                if (setMode === 'c') desc = "No Air";

                player.sendMessage(`§eStarting structure placement... [Mode: ${setMode.toUpperCase()} - ${desc}]`);
                activeJob = session.placeStructureJob(setMode);
                break;

            case "end":
                session.reset();
                activeJob = null;
                player.sendMessage("§eAll data reset.");
                break;

            default:
                player.sendMessage("§cUnknown command.");
        }
    });
});

world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const player = event.player;
    if (!player.hasTag(CONFIG.REQUIRED_TAG)) return;

    const item = event.itemStack;
    if (item?.typeId === CONFIG.TOOL_ID) {
        event.cancel = true; 
        
        system.run(() => {
            const session = getSession(player);
            const blockLoc = event.block.location;
            const centerPos = Vector3.fromBlockCenter(blockLoc);

            if (player.isSneaking) {
                session.toggleSelection(centerPos);
                return;
            }

            if (session.state === INPUT_STATE.PLACING_REALTIME_POINT) {
                session.finalizeRealtimePoint(centerPos);
                return;
            }

            if (session.state === INPUT_STATE.MOVING_POINTS) {
                session.executeMove(centerPos);
                return;
            }
            
            if (session.state === INPUT_STATE.ADDING_POINT) {
                session.executeAddPoint(centerPos);
                return;
            }

            if (session.selectedPoints.length > 0) {
                 session.clearSelection();
                 return;
            }

            if (session.state !== INPUT_STATE.IDLE) {
                session.addPoint(centerPos);
            }
        });
    }
});

system.runInterval(() => {
    if (activeJob) {
        const res = activeJob.next();
        if (res.done) activeJob = null;
    }

    for (const player of world.getAllPlayers()) {
        if (!player.hasTag(CONFIG.REQUIRED_TAG)) continue;
        const session = sessions.get(player.id);
        if (!session) continue;
        const dim = player.dimension;
        
        if (session.mode !== MODES.NONE) {
            const modeName = session.mode.replace("mode_", "").toUpperCase();
            player.onScreenDisplay.setActionBar(`§eMode: ${modeName}`);
        }

        if (session.state === INPUT_STATE.PLACING_REALTIME_POINT) {
            session.updateRealtimePoint(player.location);
        }

        const playerPos = player.location;

        if (session.mode !== MODES.NONE) {
            if (session.vectorStart) Renderer.drawPoint(dim, session.vectorStart, playerPos);
            if (session.vectorEnd) {
                Renderer.drawPoint(dim, session.vectorEnd, playerPos);
                Renderer.drawVector(dim, session.vectorStart, session.vectorEnd, playerPos);
            }
            if (session.vectorGStart) Renderer.drawPoint(dim, session.vectorGStart, playerPos);
            if (session.vectorGEnd) {
                Renderer.drawPoint(dim, session.vectorGEnd, playerPos);
                Renderer.drawVector(dim, session.vectorGStart, session.vectorGEnd, playerPos);
            }
            if (session.vectorHStart) Renderer.drawPoint(dim, session.vectorHStart, playerPos);
            if (session.vectorHEnd) {
                Renderer.drawPoint(dim, session.vectorHEnd, playerPos);
                Renderer.drawVector(dim, session.vectorHStart, session.vectorHEnd, playerPos);
            }
            if (session.vectorTSStart) Renderer.drawPoint(dim, session.vectorTSStart, playerPos);
            if (session.vectorTSEnd) {
                Renderer.drawPoint(dim, session.vectorTSEnd, playerPos);
                Renderer.drawVector(dim, session.vectorTSStart, session.vectorTSEnd, playerPos);
                Renderer.drawGuideLine(dim, session.vectorTSStart, session.vectorTSEnd, playerPos);
            }
            if (session.vectorRStart) Renderer.drawPoint(dim, session.vectorRStart, playerPos);
            if (session.vectorREnd) {
                 Renderer.drawPoint(dim, session.vectorREnd, playerPos);
                 Renderer.drawVector(dim, session.vectorRStart, session.vectorREnd, playerPos);
            }

            for (const p of session.points) Renderer.drawPoint(dim, p, playerPos);
            if (session.previewPoints.length > 0) Renderer.drawCurve(dim, session.previewPoints, playerPos);

            if ((session.mode === MODES.MODE_A || session.mode === MODES.MODE_A1 || session.mode === MODES.MODE_A2) && 
                session.generatedEndTangent && session.previewPoints.length > 0) {
                
                const pStart = session.previewPoints[session.previewPoints.length - 1];
                const len = 5.0; 
                const tan = session.generatedEndTangent;
                const slope = session.generatedEndSlope;
                
                const pEnd = {
                    x: pStart.x + tan.x * len,
                    y: pStart.y + slope * len,
                    z: pStart.z + tan.z * len
                };
                
                Renderer.drawGuideLine(dim, pStart, pEnd, playerPos);
            }
        }
        
        for (const item of session.selectedPoints) {
            Renderer.drawSelectedPoint(dim, item.ref, playerPos);
        }

        if (session.sourceP1) Renderer.drawPoint(dim, session.sourceP1, playerPos);
        if (session.sourceP2) Renderer.drawPoint(dim, session.sourceP2, playerPos);
        
        if (session.sourceMin && session.sourceMax) {
            Renderer.drawBox(dim, session.sourceMin, session.sourceMax, playerPos);

            const min = session.sourceMin;
            const max = session.sourceMax;
            const dir = session.sourceDirection; 
            
            let pivotX, pivotY, pivotZ;
            if (session.customAxis) {
                pivotX = Math.floor(session.customAxis.x) + 0.5;
                pivotY = Math.floor(session.customAxis.y) + 0.5;
                pivotZ = Math.floor(session.customAxis.z) + 0.5;
            } else {
                pivotY = min.y + 0.5; 
                pivotX = (min.x + max.x + 1)/2;
                pivotZ = (min.z + max.z + 1)/2;
            }

            let len = 0;
            if (dir.includes('x')) len = max.x - min.x + 1;
            else len = max.z - min.z + 1;

            let pStart, pEnd;
            const ext = len; 

            if (dir === "+x") {
                pStart = { x: min.x - ext, y: pivotY, z: pivotZ };
                pEnd   = { x: max.x + 1 + ext, y: pivotY, z: pivotZ };
            } else if (dir === "-x") {
                pStart = { x: max.x + 1 + ext, y: pivotY, z: pivotZ };
                pEnd   = { x: min.x - ext, y: pivotY, z: pivotZ };
            } else if (dir === "+z") {
                pStart = { x: pivotX, y: pivotY, z: min.z - ext };
                pEnd   = { x: pivotX, y: pivotY, z: max.z + 1 + ext };
            } else if (dir === "-z") {
                pStart = { x: pivotX, y: pivotY, z: max.z + 1 + ext };
                pEnd   = { x: pivotX, y: pivotY, z: min.z - ext };
            }

            Renderer.drawAxis(dim, pStart, pEnd, playerPos);
            Renderer.drawPoint(dim, {x: pivotX, y: pivotY, z: pivotZ}, playerPos);
        }
    }
}, CONFIG.TICK_INTERVAL);

world.afterEvents.playerLeave.subscribe((event) => {
    sessions.delete(event.playerId);
});