import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const styleVars = (style: string) => {
  const block = new RegExp(`\\[data-architectural-style="${style}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(block, `style "${style}" tidak ada di styles.css`);
  const vars = new Map<string, string>();
  for (const line of block[1].split("\n")) {
    const match = /--([\w-]+):\s*([^;]+);/.exec(line);
    if (match) vars.set(match[1], match[2].trim());
  }
  return vars;
};

const WALL_VARS = ["architectural-wall-light", "architectural-wall-mid", "architectural-wall-deep"];

test("style oranye terang memakai tone monokrom di luar warna dinding", () => {
  const mono = styleVars("mono");
  const orange = styleVars("lightorange");
  for (const [name, value] of mono) {
    if (WALL_VARS.includes(name)) continue;
    assert.equal(orange.get(name), value, `${name} harus sama dengan monokrom`);
  }
});

test("dinding oranye terang memakai oranye bata, bukan abu monokrom", () => {
  const mono = styleVars("mono");
  const orange = styleVars("lightorange");
  for (const name of WALL_VARS) {
    assert.equal(orange.get(name), "#bd5b28", `${name} harus oranye bata`);
    assert.notEqual(orange.get(name), mono.get(name), `${name} harus beda dari monokrom`);
  }
});

test("tombol style oranye terang punya swatch dan terdaftar di pilihan", () => {
  assert.match(css, /\.architectural-swatch-lightorange\s*\{/);
  const sketch = readFileSync(new URL("../routes/sketch.tsx", import.meta.url), "utf8");
  assert.match(sketch, /\["lightorange",\s*"Oranye Terang"\]/);
  assert.match(sketch, /"tosca" \| "brown" \| "blue" \| "bata" \| "mono" \| "lightorange"/);
});

// Monokrom dan Oranye Terang: sudut kiri atas gradien lantai diperterang 50%
// dari #f5f5f5 menjadi #fafafa, sementara sudut kanan bawah tetap #e1e1e1.
test("sudut kiri atas gradien lantai monokrom dan oranye terang lebih terang 50%", () => {
  for (const style of ["mono", "lightorange"]) {
    const vars = styleVars(style);
    assert.equal(vars.get("architectural-floor-light"), "#fafafa", `sudut kiri atas ${style} harus #fafafa`);
    assert.equal(vars.get("architectural-floor-deep"), "#e1e1e1", `sudut kanan bawah ${style} harus tetap #e1e1e1`);
  }
});

