import type * as THREE from "three";

import { pinDetail } from "./helpers";
import { openWalk, TIMES } from "./spots";
import { expect, test } from "./test";

// render.no-pop (docs/invariants.md): nothing in view jumps in size more than the camera's move explains.
// It walks up to a plant until the action button can shake it, then backs away, and on each frame draws each
// plant near the walker alone and finds its top. The top is in metres on the plant's own upright plane, so a
// camera move alone leaves it the same, up to a pixel. #1109: the plant in reach grew 8% in one frame.

test.use({ viewport: { width: 1280, height: 720 } });

/** The scene's parts this test reads. They are private to the scene, so the test casts to reach them, as drawn-solid.spec.ts does. */
type Inner = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  tick: (dt: number) => void;
  plants: { chunks: { mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> }[]; readyIndex: number };
};
/** One frame: the plant the action button shakes (-1: none), and each near plant's drawn top in metres, with the change one frame may show. */
type Seen = { ready: number; tops: { i: number; top: number; tol: number }[] };
type Follow = { __follow: (until: "ready" | "none", after: number, most: number) => Promise<Seen[]> };

/** Sets window.__follow: it measures every frame until the plant in reach is set (or gone), then `after` frames more. */
function install() {
  const s = window.__garden as unknown as Inner;
  // One frame is a 60th of a second of game time, however slow the machine (CI's software WebGL draws about 7 a
  // second): so each frame's step is small and the same on every run.
  const tick = s.tick.bind(s);
  s.tick = (dt) => tick(dt > 0 ? 1 / 60 : 0);
  const r = s.renderer;
  const cam = s.camera;
  const gl = r.getContext();
  const V = cam.position.constructor as new (x?: number, y?: number, z?: number) => THREE.Vector3;
  // Each plant's chunk and foot, from its instance attributes.
  const where = new Map<number, { mesh: Inner["plants"]["chunks"][number]["mesh"]; foot: THREE.Vector3 }>();
  for (const { mesh } of s.plants.chunks) {
    const params = mesh.geometry.getAttribute("iParams");
    const pos = mesh.geometry.getAttribute("iPos");
    for (let k = 0; k < params.count; k++) where.set(params.getW(k), { mesh, foot: new V(pos.getX(k), pos.getY(k), pos.getZ(k)) });
  }
  // The plant material, drawing only the plant at uSelected, all white: the real vertex shader, so every change of size is in it.
  const alone = new Map<THREE.ShaderMaterial, THREE.ShaderMaterial>();
  const aloneOf = (m: THREE.ShaderMaterial) => {
    const known = alone.get(m);
    if (known) return known;
    const M = m.constructor as new (p: THREE.ShaderMaterialParameters) => THREE.ShaderMaterial;
    const frag = m.fragmentShader.replace("void main() {", "void main() {\n  if (vSel < 0.5) discard;").replace(/\}\s*$/, "  gl_FragColor = vec4(1.0);\n}\n");
    const made = new M({ uniforms: { ...m.uniforms, uSelected: { value: -1 } }, vertexShader: m.vertexShader, fragmentShader: frag });
    alone.set(m, made);
    return made;
  };
  const tmp = new V();
  const measure = (): Seen => {
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const e = cam.matrixWorldInverse.elements;
    // The camera's right, level; the plants' upright plane faces along N.
    const R = new V(e[0], 0, e[8]).normalize();
    const N = new V(-R.z, 0, R.x);
    const halfH = Math.tan((cam.fov * Math.PI) / 360);
    // A Color to keep the clear colour in: three is not importable here, so a copy of one the scene made.
    const clear = (s.plants.chunks[0].mesh.material.uniforms.uFog.value as THREE.Color).clone();
    r.getClearColor(clear);
    const clearAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 1);
    const tops: Seen["tops"] = [];
    for (const [i, { mesh, foot }] of where) {
      const depth = -tmp.copy(foot).applyMatrix4(cam.matrixWorldInverse).z;
      if (Math.hypot(foot.x - cam.position.x, foot.z - cam.position.z) > 3.5 || depth < 0.3) continue;
      // The part of the screen the plant can cover: 1.5 m to each side of its foot, up to 2.4 m, every way it can lean.
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (const side of [-1.5, 1.5])
        for (const up of [-0.3, 2.4]) {
          tmp.set(foot.x + R.x * side, foot.y + up, foot.z + R.z * side).project(cam);
          x0 = Math.min(x0, Math.floor(((tmp.x + 1) / 2) * W));
          x1 = Math.max(x1, Math.ceil(((tmp.x + 1) / 2) * W));
          y0 = Math.min(y0, Math.floor(((tmp.y + 1) / 2) * H));
          y1 = Math.max(y1, Math.ceil(((tmp.y + 1) / 2) * H));
        }
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(W, x1);
      y1 = Math.min(H, y1);
      if (x1 <= x0 || y1 <= y0) continue;
      const real = mesh.material;
      const mat = aloneOf(real);
      mat.uniforms.uSelected.value = i;
      mesh.material = mat;
      r.render(mesh, cam);
      mesh.material = real;
      const w = x1 - x0;
      const h = y1 - y0;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let top = -1, bottom = h, left = w, right = -1;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (px[(y * w + x) * 4] > 127) {
            top = Math.max(top, y);
            bottom = Math.min(bottom, y);
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
      // Not drawn, or cut by the screen's edge: its top is not all in view.
      if (top < 0 || x0 + left === 0 || y0 + bottom === 0 || x0 + right === W - 1 || y0 + top === H - 1) continue;
      // The top row, on the plant's upright plane (the camera never rolls, so a row is one height there).
      const ray = new V((((x0 + (left + right + 1) / 2) / W) * 2 - 1), (((y0 + top + 1) / H) * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
      const t = tmp.copy(foot).sub(cam.position).dot(N) / ray.dot(N);
      const height = cam.position.y + ray.y * t - foot.y;
      // Two pixels of rasterising, or 2% of the height: walking or turning moves no plant's top more than that in a frame.
      const metresPerPixel = (depth * 2 * halfH) / H;
      tops.push({ i, top: height, tol: Math.max(2 * metresPerPixel, 0.02 * height) });
    }
    // The scene's own clear colour again. Its next frame draws over the canvas, so the test does not redraw it (one draw
    // less a frame on CI's software WebGL).
    r.setClearColor(clear, clearAlpha);
    return { ready: s.plants.readyIndex, tops };
  };
  (window as unknown as Follow).__follow = (until, after, most) =>
    new Promise((done) => {
      const out: Seen[] = [];
      let left = -1;
      const frame = () => {
        const seen = measure();
        out.push(seen);
        if (left < 0 && (until === "ready" ? seen.ready >= 0 : seen.ready < 0)) left = after;
        if (left === 0 || out.length >= most) return done(out);
        if (left > 0) left--;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
}

test("render.no-pop: a plant's drawn size changes only as the camera's move explains, as you walk up to one and away", async ({ page }) => {
  await page.clock.setFixedTime(TIMES.day);
  await pinDetail(page, "low");
  // Small, so every plant has its full-size sprite and the walk is quick on CI.
  await openWalk(page, "es:30", "as it is");
  await page.evaluate(install);
  const follow = (until: "ready" | "none") => page.evaluate(([u]) => (window as unknown as Follow).__follow(u, 20, 200), [until] as const);
  // From where the walk opens, straight at the first bed, until a plant is in reach; then back, until none is.
  await page.keyboard.down("w");
  const there = await follow("ready");
  await page.keyboard.up("w");
  await page.keyboard.down("s");
  const back = await follow("none");
  await page.keyboard.up("s");
  expect(there.some((f) => f.ready >= 0), "a plant came in reach").toBe(true);
  expect(back.at(-1)!.ready, "no plant in reach at the end").toBe(-1);

  const frames = [...there, ...back];
  const jumps: string[] = [];
  for (let k = 1; k < frames.length; k++)
    for (const b of frames[k].tops) {
      const a = frames[k - 1].tops.find((t) => t.i === b.i);
      if (a && Math.abs(b.top - a.top) > Math.max(a.tol, b.tol))
        jumps.push(`plant ${b.i}, frame ${k}${b.i === frames[k].ready ? " (in reach)" : ""}: top ${a.top.toFixed(3)} m -> ${b.top.toFixed(3)} m`);
    }
  expect(jumps).toEqual([]);
  // The plant in reach was measured on the frames round the change, so the check saw it.
  const reached = there.find((f) => f.ready >= 0)!.ready;
  expect(frames.filter((f) => f.tops.some((t) => t.i === reached)).length, "frames that measured the plant in reach").toBeGreaterThan(30);
});
