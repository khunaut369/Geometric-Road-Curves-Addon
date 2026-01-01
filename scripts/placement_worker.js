// scripts/placement_worker.js
import { CONFIG } from './config.js';
import { Vector3 } from './math_utils.js';
import { BlockPermutation } from '@minecraft/server';

export function* placeStructureWorker(session, setMode) {
    if (!session.previewPoints.length) return;
    if (!session.sourceMin || !session.sourceMax) {
        session.player.sendMessage("§cPlease select a Region first (!sct).");
        return;
    }

    const dim = session.player.dimension;
    const sMin = session.sourceMin;
    const sMax = session.sourceMax;
    const dir = session.sourceDirection;
    
    let width, height, length;

    // Calculate dimensions
    if (dir === "+x" || dir === "-x") {
        width = sMax.z - sMin.z + 1;
        height = sMax.y - sMin.y + 1;
        length = sMax.x - sMin.x + 1;
    } else { // +z, -z
        width = sMax.x - sMin.x + 1;
        height = sMax.y - sMin.y + 1;
        length = sMax.z - sMin.z + 1;
    }

    let startTime = Date.now();
    session.currentLoaderCenter = null;
    const undoList = [];
    const MAX_UNDO_SIZE = 10000; // Limit undo to prevent memory crash on massive builds
    let undoLimitReached = false;

    // Helper: Report progress
    const reportProgress = (current, total, lastStep, label) => {
        if (total <= 0) return lastStep;
        const percent = (current / total) * 100;
        const step = Math.floor(percent / 10); // Report every 10%
        
        if (step > lastStep) {
            const displayPercent = step * 10;
            if (displayPercent <= 100) {
                 session.player.sendMessage(`§e[${label}] Progress: ${displayPercent}%`);
            }
            return step;
        }
        return lastStep;
    };

    try {
        // ==========================================
        // PHASE 1: Caching Source Blocks
        // ==========================================
        session.player.sendMessage("§e[1/2] Caching Source Blocks...");
        const sourceBlocks = []; 
        const airPerm = BlockPermutation.resolve("air");

        const totalCache = width * height * length;
        let processedCache = 0;
        let lastCacheStep = -1;

        for (let y = 0; y < height; y++) {
            sourceBlocks[y] = [];
            for (let w = 0; w < width; w++) {
                sourceBlocks[y][w] = [];
                for (let l = 0; l < length; l++) {
                    let sx, sy, sz;
                    sy = sMin.y + y;

                    if (dir === "+z") { sz = sMin.z + l; sx = sMax.x - w; } 
                    else if (dir === "-z") { sz = sMax.z - l; sx = sMin.x + w; }
                    else if (dir === "+x") { sx = sMin.x + l; sz = sMin.z + w; }
                    else if (dir === "-x") { sx = sMax.x - l; sz = sMax.z - w; }

                    const block = yield* session.getStrictBlock(dim, sx, sy, sz);
                    sourceBlocks[y][w][l] = block ? block.permutation : airPerm;

                    processedCache++;
                    lastCacheStep = reportProgress(processedCache, totalCache, lastCacheStep, "Reading");

                    if (Date.now() - startTime > CONFIG.TIME_BUDGET) {
                        yield; startTime = Date.now();
                    }
                }
            }
        }
        
        try { dim.runCommand(`tickingarea remove ${CONFIG.LOADER_ID}`); } catch(e){}
        session.currentLoaderCenter = null;

        // ==========================================
        // PHASE 2: Streamed Processing (Segmented)
        // ==========================================
        // Instead of calculating everything at once, we process in segments to free memory.
        const BATCH_DIST = 32.0; // Process 32 meters of curve at a time
        const totalDist = session.totalLength;
        const stepSize = 0.1;
        
        const clipStartPoint = session.previewPoints[0];
        const clipStartTan = clipStartPoint.tangent || new Vector3(1,0,0);
        const clipEndPoint = session.previewPoints[session.previewPoints.length - 1];
        const clipEndTan = clipEndPoint.tangent || session.previewPoints[session.previewPoints.length - 2]?.tangent || new Vector3(1,0,0);
        
        const disableClipping = (session.mode === 'mode_c'); 
        const safeHeadRange = 2.0;
        const safeTailRange = totalDist - 2.0;

        let centerOffsetW, axisY;
        if (session.customAxis) {
            const cPos = { 
                x: Math.floor(session.customAxis.x), 
                y: Math.floor(session.customAxis.y), 
                z: Math.floor(session.customAxis.z) 
            };
            axisY = cPos.y - sMin.y;
            if (dir === "+z") centerOffsetW = sMax.x - cPos.x;
            else if (dir === "-z") centerOffsetW = cPos.x - sMin.x;
            else if (dir === "+x") centerOffsetW = cPos.z - sMin.z;
            else if (dir === "-x") centerOffsetW = sMax.z - cPos.z;
        } else {
            centerOffsetW = (width - 1) / 2.0;
            axisY = 0;
        }

        session.player.sendMessage(`§e[2/2] Streaming Construction (Length: ${totalDist.toFixed(1)}m)...`);
        
        let blocksPlaced = 0;
        let lastProgressStep = -1;

        // --- OUTER LOOP: Process Segment by Segment ---
        for (let currentStartDist = -0.5; currentStartDist < totalDist + 0.5; currentStartDist += BATCH_DIST) {
            
            // 2.1 Calculate Votes for this segment
            const voteMap = new Map();
            const currentEndDist = Math.min(currentStartDist + BATCH_DIST, totalDist + 0.5);
            
            for (let dist = currentStartDist; dist < currentEndDist; dist += stepSize) {
                // Determine curve state
                const { pos, tan } = session.getCurveStateAtDistance(dist);
                const normal = tan.crossY().normalize();
                const textureDist = Math.max(0, Math.min(dist, session.totalLength));
                const lIndex = Math.floor(textureDist) % length;
                const checkClipping = !disableClipping && (dist < safeHeadRange || dist > safeTailRange);

                for (let y = 0; y < height; y++) {
                    for (let w = 0; w < width; w++) {
                        const offsetSide = w - centerOffsetW;
                        const tx = pos.x + (normal.x * offsetSide);
                        const ty = pos.y + (y - axisY); 
                        const tz = pos.z + (normal.z * offsetSide);

                        if (checkClipping) {
                             if (dist < safeHeadRange) {
                                const dx = tx - clipStartPoint.x, dz = tz - clipStartPoint.z;
                                if (dx * clipStartTan.x + dz * clipStartTan.z < -0.01) continue;
                            }
                            if (dist > safeTailRange) {
                                const dx = tx - clipEndPoint.x, dz = tz - clipEndPoint.z;
                                if (dx * clipEndTan.x + dz * clipEndTan.z > 0.01) continue;
                            }
                        }

                        const bx = Math.floor(tx);
                        const by = Math.floor(ty);
                        const bz = Math.floor(tz);
                        const targetKey = `${bx},${by},${bz}`;

                        // Optimized Map Key access
                        let votes = voteMap.get(targetKey);
                        if (!votes) {
                            votes = new Map();
                            voteMap.set(targetKey, votes);
                        }
                        const sourceKey = `${y},${w},${lIndex}`;
                        votes.set(sourceKey, (votes.get(sourceKey) || 0) + 1);
                    }
                }
                
                // Budget Check inside Loop
                if (Date.now() - startTime > CONFIG.TIME_BUDGET) {
                    yield; startTime = Date.now();
                }
            }

            // 2.2 Process Votes & Batch by Chunk (Local for this segment)
            const chunkBatches = new Map();
            for (const [targetKey, votes] of voteMap) {
                let maxVotes = -1;
                let winnerSourceKey = null;
                for (const [sKey, count] of votes) {
                    if (count > maxVotes) {
                        maxVotes = count;
                        winnerSourceKey = sKey;
                    }
                }

                if (winnerSourceKey) {
                    const [bx, by, bz] = targetKey.split(',').map(Number);
                    const [sy, sw, sl] = winnerSourceKey.split(',').map(Number);
                    const winnerPerm = sourceBlocks[sy][sw][sl];
                    const isSourceAir = (winnerPerm.type.id === "minecraft:air");

                    let shouldPlace = false;
                    if (setMode === 'a') shouldPlace = true;
                    else if (setMode === 'b') shouldPlace = true; // Checked later
                    else if (setMode === 'c') {
                        if (!isSourceAir) shouldPlace = true;
                    }

                    if (shouldPlace) {
                        const chunkKey = `${Math.floor(bx / 16)},${Math.floor(bz / 16)}`;
                        if (!chunkBatches.has(chunkKey)) chunkBatches.set(chunkKey, []);
                        chunkBatches.get(chunkKey).push({
                            x: bx, y: by, z: bz,
                            perm: winnerPerm,
                            isSourceAir: isSourceAir
                        });
                    }
                }
            }
            
            // Clear VoteMap immediately to free memory
            voteMap.clear();

            // 2.3 Place Blocks for this segment
            for (const [chunkKey, blocks] of chunkBatches) {
                const [cx, cz] = chunkKey.split(',').map(Number);
                const loadX = (cx * 16) + 8;
                const loadZ = (cz * 16) + 8;
                const loadY = blocks[0].y; 

                yield* session.moveLoader(dim, loadX, loadY, loadZ);

                for (const item of blocks) {
                    try {
                        const targetBlock = dim.getBlock({ x: item.x, y: item.y, z: item.z });
                        if (targetBlock) {
                            let finalCheck = true;
                            if (setMode === 'b' && targetBlock.typeId !== "minecraft:air") {
                                finalCheck = false;
                            }

                            if (finalCheck) {
                                // Simple perm check to avoid redundant sets
                                if (targetBlock.permutation.type.id !== item.perm.type.id || 
                                    JSON.stringify(targetBlock.permutation.getState()) !== JSON.stringify(item.perm.getState())) {
                                    
                                    // Memory Protection: Stop recording undo if too large
                                    if (undoList.length < MAX_UNDO_SIZE) {
                                        undoList.push({
                                            x: item.x, y: item.y, z: item.z,
                                            oldPerm: targetBlock.permutation,
                                            newPerm: item.perm
                                        });
                                    } else if (!undoLimitReached) {
                                        undoLimitReached = true;
                                        session.player.sendMessage("§e[Info] Undo history limit reached. Stopping undo recording to prevent crash.");
                                    }

                                    targetBlock.setPermutation(item.perm);
                                    blocksPlaced++;
                                }
                            }
                        }
                    } catch (e) {}
                }
                
                // Budget Check
                if (Date.now() - startTime > CONFIG.TIME_BUDGET) {
                    yield; startTime = Date.now();
                }
            }

            // Clear ChunkBatches immediately
            chunkBatches.clear();

            // Report Global Progress
            lastProgressStep = reportProgress(currentStartDist + BATCH_DIST, totalDist, lastProgressStep, "Building");
            
            // Explicitly Yield to allow GC to run between segments
            yield;
        }

        session.player.sendMessage(`§aSuccess! Placed ${blocksPlaced} blocks.`);
        if (undoList.length > 0) {
            session.history.pushBlockChange(undoList);
        }

    } finally {
        try { dim.runCommand(`tickingarea remove ${CONFIG.LOADER_ID}`); } catch(e){}
    }
}
