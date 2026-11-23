// Prototype entry for the real-PC 3D work: the PC scene and the board scene on their own.
export { createScene } from "./scene";
export { createBoardScene } from "./boardScene";
export { sceneTheme } from "./themes";
export * as THREE from "three";
export { makeGpu, makeCooler, makeRam, makeFan, realMaterial, plainFan, type Kit } from "./parts3d";
export { makeBoard } from "./board3d";
export { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
export { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
