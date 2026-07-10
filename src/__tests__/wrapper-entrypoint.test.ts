import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// Root cause of the reported "install-wrapper" silent no-op (0s, exit 0, zero
// output): src/wrapper.ts only calls runWrapper() behind an
// `if (require.main === module)` guard. That guard is preserved correctly by
// ts-jest (which is why wrapper.test.ts's direct `import { runWrapper }` and
// explicit call works fine), but @vercel/ncc's bundling of that same check
// into dist/wrapper/index.js evaluates to `false` at runtime for the *real*,
// installed, script-invoked wrapper - so runWrapper() is never called at all
// when a user's workflow runs `atmos ...`. Node just loads the module,
// defines everything, and exits 0 with no output, which is exactly the
// reported symptom. This is unrelated to install path/tool-cache; it
// reproduces identically whether the wrapper is invoked from the old
// `_actions/.../atmos` layout or the new tool-cache layout - see
// wrapper-cache-integration.test.ts, which reproduces it through the full
// production install pipeline, and this file, which isolates it to just
// "does running the compiled entry point invoke runWrapper() at all".
//
// This file intentionally runs the real, committed dist/wrapper/index.js
// directly via `node`, with no installer/tool-cache involved, to prove the
// defect lives in the compiled entry point itself, not in how it gets
// installed.
describe("wrapper compiled entry point", () => {
  const wrapperDist = path.resolve(__dirname, "..", "..", "dist", "wrapper", "index.js");

  let fixtureDir: string;
  let fixtureBinPath: string;

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "atmos-entrypoint-fixture-"));
    fixtureBinPath = path.join(fixtureDir, "atmos-bin");
    fs.writeFileSync(fixtureBinPath, '#!/bin/sh\necho "REAL ATMOS RAN: $*"\nexit 0\n', "utf8");
    fs.chmodSync(fixtureBinPath, 0o775);
  });

  afterEach(() => {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("invokes runWrapper() and execs atmos-bin when run as a script", () => {
    expect(fs.existsSync(wrapperDist)).toBe(true);

    let stdout: string;
    try {
      stdout = execFileSync("node", [wrapperDist, "terraform", "apply", "example", "-s", "test-stack"], {
        env: { ...process.env, ATMOS_CLI_PATH: fixtureDir },
        encoding: "utf8",
        timeout: 10_000
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
      throw new Error(
        `dist/wrapper/index.js failed: status=${e.status} stdout=${e.stdout ?? ""} stderr=${e.stderr ?? ""} (${e.message})`
      );
    }

    // Today this is "" because require.main === module is false in the ncc
    // bundle, so runWrapper() (and its `core.info("path: " + pathToCLI)`
    // call, which would otherwise be the very first line of output) never
    // runs at all.
    expect(stdout).toContain("REAL ATMOS RAN: terraform apply example -s test-stack");
  });
});
