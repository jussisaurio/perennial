// Temporary (#960): what a frame in the frog test's view costs on CI, part by part. Never merged.
import { test } from "./test";
import { pinDetail } from "./helpers";

test("tmp-cost 300", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date("2026-10-11T19:00:00"));
  await pinDetail(page, "normal");
  await page.goto(`/?demo=es:known:300&visitors=frog#/today`);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await page.waitForFunction(() => "__garden" in window);
  await page.evaluate(() => {
    type Sprite = { v: { id: string }; body: { at: { x: number; z: number } } };
    const s = (window as unknown as { __garden: { guests: { sprites: Sprite[] }; layout: { pond: { x: number; z: number } }; x: number; z: number; yaw: number; pitch: number } }).__garden;
    const frog = s.guests.sprites.find((o) => o.v.id === "frog")!.body.at;
    const a = Math.atan2(frog.x - s.layout.pond.x, frog.z - s.layout.pond.z);
    s.x = frog.x + Math.sin(a) * 1.3;
    s.z = frog.z + Math.cos(a) * 1.3;
    s.yaw = a;
    s.pitch = -0.45;
  });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async () => {
    type O = {
      type: string;
      visible: boolean;
      isInstancedMesh?: boolean;
      count?: number;
      material?: { type: string; transparent: boolean } | { type: string; transparent: boolean }[];
      geometry?: { index: { count: number } | null; attributes: { position?: { count: number } }; instanceCount?: number };
      children: O[];
      traverse: (f: (o: O) => void) => void;
    };
    type G = {
      renderer: { render: (s: unknown, c: unknown) => void; getContext: () => WebGL2RenderingContext; info: { render: { triangles: number; calls: number } }; getSize: (v: unknown) => { x: number; y: number } };
      scene: O;
      camera: unknown;
      setDetail: (d: string) => void;
      size: [number, number];
    };
    const g = (window as unknown as { __garden: G }).__garden;
    const gl = g.renderer.getContext();
    const px = new Uint8Array(4);
    // One render, waited for: readPixels returns only once the GPU process has drawn it.
    const time = () => {
      const ts: number[] = [];
      g.renderer.render(g.scene, g.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        g.renderer.render(g.scene, g.camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ts.push(performance.now() - t);
      }
      ts.sort((a, b) => a - b);
      const { triangles, calls } = g.renderer.info.render;
      return `${Math.round(ts[1])}ms tris ${triangles} calls ${calls}`;
    };
    const tris = (o: O) => {
      let n = 0;
      o.traverse((p) => {
        const geo = p.geometry;
        if (!geo || !p.visible) return;
        const t = (geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)) / 3;
        const k = p.isInstancedMesh ? (p.count ?? 1) : Number.isFinite(geo.instanceCount) ? geo.instanceCount! : 1;
        n += t * k;
      });
      return n;
    };
    const mat = (o: O) => (Array.isArray(o.material) ? o.material[0] : o.material);
    const kids = g.scene.children.filter((o) => o.visible);
    const lines: string[] = [];
    const fb = g.renderer.getSize({ x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; return this; } });
    lines.push(`framebuffer ${fb.x}x${fb.y}; children ${kids.length}`);
    lines.push(`all: ${time()}`);
    const without = (label: string, pick: (o: O) => boolean) => {
      const off = kids.filter(pick);
      off.forEach((o) => (o.visible = false));
      lines.push(`without ${label} (${off.length}): ${time()}`);
      off.forEach((o) => (o.visible = true));
    };
    without("everything", () => true);
    without("instanced", (o) => !!o.isInstancedMesh);
    without("shader materials", (o) => mat(o)?.type === "ShaderMaterial" || mat(o)?.type === "RawShaderMaterial");
    without("transparent", (o) => !!mat(o)?.transparent);
    without("points", (o) => o.type === "Points");
    without("groups", (o) => o.type === "Group" || o.type === "Object3D");
    const big = [...kids].sort((a, b) => tris(b) - tris(a)).slice(0, 10);
    big.forEach((o, i) => without(`big#${i} ${o.type}/${mat(o)?.type ?? "-"} ${tris(o)}t`, (p) => p === o));
    // Only one child drawn at a time, for the ten biggest.
    big.forEach((o, i) => {
      kids.forEach((p) => (p.visible = p === o));
      lines.push(`only big#${i}: ${time()}`);
      kids.forEach((p) => (p.visible = true));
    });
    g.setDetail("low");
    lines.push(`all at low: ${time()}`);
    g.setDetail("normal");
    // The loop's own frames, for comparison.
    let frames = 0;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const f = () => {
        frames++;
        if (performance.now() - t0 < 3000) requestAnimationFrame(f);
        else done();
      };
      requestAnimationFrame(f);
    });
    lines.push(`loop: ${frames} frames in 3 s`);
    return lines;
  });
  console.log(`TMPCOST\n${out.join("\n")}`);
});
