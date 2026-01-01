// scripts/history.js
import { BlockPermutation } from '@minecraft/server';
import { CONFIG } from './config.js';

export const ACTION_TYPE = {
    STATE_CHANGE: 'state_change',
    BLOCK_PLACEMENT: 'block_placement'
};

export class HistoryManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.maxSize = CONFIG.MAX_HISTORY || 20;
    }

    pushState(session) {
        const snapshot = {
            type: ACTION_TYPE.STATE_CHANGE,
            data: session.serializeState()
        };
        this.undoStack.push(snapshot);
        this.redoStack = []; 
        this.checkLimit();
    }

    pushBlockChange(changes) {
        if (changes.length === 0) return;
        const action = {
            type: ACTION_TYPE.BLOCK_PLACEMENT,
            data: changes 
        };
        this.undoStack.push(action);
        this.redoStack = [];
        this.checkLimit();
    }

    checkLimit() {
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
    }

    *undo(session, steps = 1) {
        let count = 0;
        const dim = session.player.dimension;

        while (count < steps && this.undoStack.length > 0) {
            const action = this.undoStack.pop();

            if (action.type === ACTION_TYPE.BLOCK_PLACEMENT) {
                // Blocks: Push same action to redo (contains both old/new data)
                this.redoStack.push(action);
                
                const changes = action.data;
                for (let i = changes.length - 1; i >= 0; i--) {
                    const { x, y, z, oldPerm } = changes[i];
                    try {
                        const block = dim.getBlock({ x, y, z });
                        if (block) block.setPermutation(oldPerm);
                    } catch (e) { }
                    if (i % 50 === 0) yield;
                }
                session.player.sendMessage(`§e[Undo] Reverted ${changes.length} blocks.`);
                count++;
            } 
            else if (action.type === ACTION_TYPE.STATE_CHANGE) {
                // State: Must save CURRENT state to Redo before applying OLD state
                const currentState = session.serializeState();
                const redoAction = {
                    type: ACTION_TYPE.STATE_CHANGE,
                    data: currentState
                };
                this.redoStack.push(redoAction);

                if (session.mode !== 'none') {
                    session.deserializeState(action.data);
                    session.calculatePreviewFromState(); 
                    session.player.sendMessage(`§e[Undo] State reverted successfully.`);
                    count++;
                } else {
                    session.player.sendMessage(`§7[Undo] Skipped (Not in mode).`);
                }
            }
            yield;
        }
        
        if (count === 0 && this.undoStack.length === 0) {
            session.player.sendMessage("§cNothing left to Undo.");
        }
    }

    *redo(session, steps = 1) {
        let count = 0;
        const dim = session.player.dimension;

        while (count < steps && this.redoStack.length > 0) {
            const action = this.redoStack.pop();

            if (action.type === ACTION_TYPE.BLOCK_PLACEMENT) {
                // Blocks: Push same action back to undo
                this.undoStack.push(action);

                const changes = action.data;
                for (let i = 0; i < changes.length; i++) {
                    const { x, y, z, newPerm } = changes[i];
                    try {
                        const block = dim.getBlock({ x, y, z });
                        if (block) block.setPermutation(newPerm);
                    } catch (e) { }
                    if (i % 50 === 0) yield;
                }
                session.player.sendMessage(`§e[Redo] Re-applied ${changes.length} blocks.`);
                count++;
            } 
            else if (action.type === ACTION_TYPE.STATE_CHANGE) {
                // State: Save CURRENT state to Undo before applying NEW state
                const currentState = session.serializeState();
                const undoAction = {
                    type: ACTION_TYPE.STATE_CHANGE,
                    data: currentState
                };
                this.undoStack.push(undoAction);

                if (session.mode !== 'none') {
                    session.deserializeState(action.data);
                    session.calculatePreviewFromState();
                    session.player.sendMessage(`§e[Redo] State re-applied successfully.`);
                    count++;
                } else {
                    session.player.sendMessage(`§7[Redo] Skipped (Not in mode).`);
                }
            }
            yield;
        }

        if (count === 0 && this.redoStack.length === 0) {
            session.player.sendMessage("§cNothing left to Redo.");
        }
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }
}