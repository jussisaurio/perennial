import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { showCell } from "./sceneVisitors";

describe("visitor texture cells", () => {
  test("showing the same cell again uploads nothing, for every cell", () => {
    // Any atlas size: 23 cells is about the walk's, and its fractions do not round evenly in float32.
    const cells = 23;
    for (let cell = 0; cell < cells; cell++) {
      const uv = new THREE.InstancedBufferAttribute(new Float32Array(2), 2);
      showCell(uv, cell === 0 ? 1 : 0, cells); // start somewhere else
      const before = uv.version;
      showCell(uv, cell, cells);
      expect(uv.version).toBe(before + 1); // a change uploads once
      showCell(uv, cell, cells);
      expect(uv.version).toBe(before + 1); // the same cell again: no upload
    }
  });
});
