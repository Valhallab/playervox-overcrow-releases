// The VM's turns on games of thousands of achievements. A widget runs on a
// quarter of one core and each JavaScript turn has 50 ms of wall time:
// every turn must stay a few milliseconds of CPU, whatever the game. Each
// case runs tests/turn-driver.mjs in its own process (one game each), the
// time measured without the JIT, the interpreter QuickJS is closest to.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const DRIVER = new URL("./turn-driver.mjs", import.meta.url).pathname;
const ROOT = new URL("../", import.meta.url).pathname;

/**
 * The longest turn allowed under Node without its JIT. On the workstation
 * where this was measured, the 1.1.0 widget's heaviest turns took 5.2 ms
 * (5,000 achievements) and 12.8 ms (12,000) here, and 22.8 and 27.4 ms in
 * the VM's QuickJS (release), too long under its CPU ceiling. Sliced, the
 * heaviest take about 2 ms here (an answer read in slices), 4 ms there.
 */
const TURN_MS = 3;

function drive(mode, count, flags = []) {
  const output = execFileSync(process.execPath, [...flags, DRIVER, mode, String(count)], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(output.trim().split("\n").at(-1));
}

for (const count of [5000, 12000]) {
  test(`${count} achievements: no turn beyond its share, under Node without JIT`, () => {
    // The machine may be busy: the best of three runs.
    let run;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      run = drive("timing", count, ["--jitless"]);
      if (Math.max(...run.turns.map((t) => t.ms)) <= TURN_MS) break;
    }
    assert.deepEqual([run.read.phase, run.read.unlocked, run.read.total, run.read.known], ["game", count / 4, count, true]);
    // The search found what one pass finds.
    assert.ok(run.searched.length > 0 && run.searched.every((name) => name.startsWith("Achievement 123")), "the search's rows");
    assert.ok(run.keyed.length > 0 && run.keyed.every((name) => name.startsWith("Achievement 99")), "the last keystroke's rows");
    assert.ok(run.tracked.includes(run.ticked), "the ticked one is tracked");
    // The checklist without a search at once; a search within a second or so.
    assert.deepEqual([run.latency.open, run.latency.more], [0, 0]);
    assert.ok(run.latency.search <= (count / 1000) * 100 + 100, `search: ${run.latency.search} ms`);
    const worst = [...run.turns].sort((a, b) => b.ms - a.ms).slice(0, 5);
    const detail = worst.map((t) => `${t.phase}/${t.label} ${t.ms.toFixed(2)} ms (${t.work} items)`).join(", ");
    assert.ok(worst[0].ms <= TURN_MS, `longest turns: ${detail}`);
  });

  test(`${count} achievements: the list items of a turn stay within the slice`, () => {
    const run = drive("timing", count);
    assert.equal(typeof run.units, "number", "the logic says its slice");
    const worst = run.turns.reduce((a, b) => (b.work > a.work ? b : a));
    assert.ok(worst.work > 0, "the work is counted");
    assert.ok(worst.work <= run.units, `${worst.phase}/${worst.label}: ${worst.work} units`);
  });

  test(`${count} achievements: the same result as one pass, actions during a job included`, () => {
    const run = drive("check", count);
    assert.deepEqual(run.final.current, run.final.reference);
    for (const name of ["tick-during", "option-during", "locale-during", "read-during"]) {
      const step = run[name];
      assert.deepEqual(step.current, step.reference, name);
      // Never an empty view while a job runs: the last one stays.
      for (const view of step.views.map((text) => JSON.parse(text))) {
        assert.notEqual(view.game, null, `${name}: the game stays`);
        assert.ok(view.recent.length > 0 && view.missing.length > 0, `${name}: the lists stay`);
      }
    }
    // No tracked achievement lost: the one ticked during a job, and before.
    assert.ok(run["tick-during"].tracked.includes(run["tick-during"].ticked));
    assert.ok(run["tick-during"].tracked.includes(run.ticked));
    assert.deepEqual(run["read-during"].tracked, run["tick-during"].tracked);
    assert.equal(run["locale-during"].current.names[0], "Achievement 0 (fr)", "the new language's names");
  });
}

test("12,000 achievements: the index and the search's keys stay well within the VM's heap", () => {
  const run = drive("memory", 12000, ["--expose-gc"]);
  const mib = (bytes) => bytes / 1024 / 1024;
  const all = mib(run.memory.all - run.memory.empty);
  const added = mib(run.memory.indexAndKeys);
  console.log(`heap (Node): the widget with the game read ${all.toFixed(1)} MiB, of which the index and the keys ${added.toFixed(1)} MiB`);
  // The manifest's heapMiB is 32; QuickJS objects are of the same order.
  assert.ok(added < 4, `${added.toFixed(1)} MiB`);
  assert.ok(all < 16, `${all.toFixed(1)} MiB`);
});

for (const count of [200, 1000]) {
  test(`${count} achievements, a usual game: each result in the turn of its action`, () => {
    const run = drive("same-turn", count);
    assert.deepEqual([run.read.phase, run.read.unlocked, run.read.total, run.read.known], ["game", count / 4, count, true]);
    assert.deepEqual(run.seen, { open: true, more: true, search: true, tick: true, close: true, order: true, read: true });
  });
}
