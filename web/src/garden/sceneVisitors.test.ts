import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { showCell } from "./sceneVisitors";
import { VISITOR_COLS } from "./textures";

describe("visitor texture cells", () => {
  test("showing the same cell again uploads nothing, for every cell", () => {
    // Any number of rows: thirds do not round evenly in float32.
    const rows = 3;
    for (let cell = 0; cell < rows * VISITOR_COLS; cell++) {
      const uv = new THREE.InstancedBufferAttribute(new Float32Array(4), 4);
      showCell(uv, cell === 0 ? 1 : 0, rows, false); // start somewhere else
      const before = uv.version;
      showCell(uv, cell, rows, false);
      expect(uv.version).toBe(before + 1); // a change uploads once
      showCell(uv, cell, rows, false);
      expect(uv.version).toBe(before + 1); // the same cell again: no upload
    }
  });
});
