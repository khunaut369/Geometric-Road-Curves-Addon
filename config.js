// scripts/config.js

export const CONFIG = {
    REQUIRED_TAG: "road",
    TOOL_ID: "minecraft:stone_pickaxe",
    PREVIEW_BLOCK: "minecraft:gold_block",
    PARTICLE_POINT: "minecraft:balloon_gas_particle", 
    PARTICLE_LINE: "minecraft:blue_flame_particle",
    PARTICLE_CURVE: "minecraft:basic_flame_particle",
    PARTICLE_REGION: "minecraft:balloon_gas_particle", 
    PARTICLE_GUIDE: "minecraft:falling_dust_top_snow_particle",
    PARTICLE_AXIS: "minecraft:endrod",
    PARTICLE_SELECTED: "minecraft:dragon_breath_trail", 
    TICK_INTERVAL: 4, 
    LOADER_ID: "curve_gen_loader",
    TIME_BUDGET: 30,
    MAX_HISTORY: 20,
    RENDER_DISTANCE: 64
};

export const MODES = {
    NONE: "none",
    MODE_A: "mode_a",
    MODE_A1: "mode_a1", 
    MODE_A2: "mode_a2",
    MODE_B: "mode_b",   // [NEW]
    MODE_B1: "mode_b1",
    MODE_B2: "mode_b2",
    MODE_C: "mode_c"
};

export const INPUT_STATE = {
    IDLE: 0,
    SELECTING_VECTOR_START: 1,
    SELECTING_VECTOR_END: 2,
    SELECTING_POINTS: 3,
    SELECTING_REGION_P1: 4,
    SELECTING_REGION_P2: 5,
    SELECTING_VECTOR_G_START: 6,
    SELECTING_VECTOR_G_END: 7,
    SELECTING_VECTOR_H_START: 8,
    SELECTING_VECTOR_H_END: 9,
    SELECTING_VECTOR_TS_START: 10,
    SELECTING_VECTOR_TS_END: 11,
    SELECTING_POINT_S: 12,
    SELECTING_VECTOR_R_START: 13,
    SELECTING_VECTOR_R_END: 14,
    SELECTING_AXIS_POINT: 15,
    MOVING_POINTS: 99,
    ADDING_POINT: 98,
    PLACING_REALTIME_POINT: 97
};