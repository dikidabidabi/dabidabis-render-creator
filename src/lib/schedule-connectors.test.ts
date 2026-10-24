import { test } from "node:test";
import { strict as assert } from "node:assert";
import { dependencySides } from "./schedule-connectors";

test("FS menghubungkan selesai pendahulu ke mulai penerus", () => assert.deepEqual(dependencySides("FS"), { source: "finish", target: "start" }));
test("SS menghubungkan mulai kedua pekerjaan", () => assert.deepEqual(dependencySides("SS"), { source: "start", target: "start" }));
test("FF menghubungkan selesai kedua pekerjaan", () => assert.deepEqual(dependencySides("FF"), { source: "finish", target: "finish" }));
test("SF menghubungkan mulai pendahulu ke selesai penerus", () => assert.deepEqual(dependencySides("SF"), { source: "start", target: "finish" }));