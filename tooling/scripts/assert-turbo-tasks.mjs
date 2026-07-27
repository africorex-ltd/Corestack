// CI truth guard (AUD-01; governance §4 "silent success is failure").
// Asserts that a turbo task actually matched work before CI treats its lane
// as meaningful. Two modes:
//   node assert-turbo-tasks.mjs <task> --min <n>
//     fails unless >= n packages ran the task.
//   node assert-turbo-tasks.mjs <task> --manifest <path>
//     fails unless the matched package set EXACTLY equals the manifest's
//     "expected" array — an explicit, versioned statement of which packages
//     carry the task. Zero-vs-zero passes honestly; adding a suite without
//     updating the manifest fails; losing a suite fails.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [task, mode, modeValue] = process.argv.slice(2);
if (!task || !mode || !modeValue || !["--min", "--manifest"].includes(mode)) {
  console.error("usage: assert-turbo-tasks.mjs <task> (--min <n> | --manifest <path>)");
  process.exit(2);
}

const dry = JSON.parse(
  execSync(`pnpm exec turbo run ${task} --dry=json`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const matched = (dry.tasks ?? [])
  .filter((t) => t.task === task && t.command && t.command !== "<NONEXISTENT>")
  .map((t) => t.package)
  .sort();

if (mode === "--min") {
  const min = Number(modeValue);
  if (matched.length < min) {
    console.error(
      `✖ turbo task "${task}" matched ${matched.length} package(s) [${matched.join(", ")}] — expected at least ${min}. A lane that runs nothing must not pass.`,
    );
    process.exit(1);
  }
  console.log(`✓ "${task}" matched ${matched.length} package(s): ${matched.join(", ")}`);
} else {
  const manifest = JSON.parse(readFileSync(modeValue, "utf8"));
  const expected = [...(manifest.expected ?? [])].sort();
  if (JSON.stringify(matched) !== JSON.stringify(expected)) {
    console.error(
      `✖ turbo task "${task}": matched [${matched.join(", ")}] but the manifest ${modeValue} expects [${expected.join(", ")}].`,
    );
    console.error(
      "  If you added or removed a suite, update the manifest in the same PR — the expectation is versioned on purpose.",
    );
    process.exit(1);
  }
  console.log(
    `✓ "${task}" matches the manifest exactly (${expected.length} package(s)${expected.length ? ": " + expected.join(", ") : ""})`,
  );
}
