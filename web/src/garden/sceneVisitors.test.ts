import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { showCell } from "./sceneVisitors";
import { VISITOR_CELLS } from "./textures";

describe("visitor texture cells", () => {
  test("showing the same cell again uploads nothing, for every cell", () => {
    for (let cell = 0; cell < VISITOR_CELLS; cell++) {
      const uv = new THREE.InstancedBufferAttribute(new Float32Array(2), 2);
      showCell(uv, cell === 0 ? 1 : 0); // start somewhere else
      const before = uv.version;
      showCell(uv, cell);
      expect(uv.version).toBe(before + 1); // a change uploads once
      showCell(uv, cell);
      expect(uv.version).toBe(before + 1); // the same cell again: no upload
    }
  });
});
