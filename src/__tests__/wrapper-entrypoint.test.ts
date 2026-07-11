import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// Root cause of the previously-reported "install-wrapper" silent no-op (0s,
// exit 0, zero output): src/wrapper.ts only called runWrapper() behind an
// `if (require.main === module)` guard. That guard was preserved correctly by
// ts-jest (which is why wrapper.test.ts's direct `import { runWrapper }` and
// explicit call worked fine), but @vercel/ncc's bundling of that same check
// into dist/wrapper/index.js evaluated to `false` at runtime for the *real*,
// installed, script-invoked wrapper - so runWrapper() was never called at all
// when a user's workflow ran `atmos ...`. Node just loaded the module,
// defined everything, and exited 0 with no output, which was exactly the
// reported symptom. This was unrelated to install path/tool-cache; it
// reproduced identically whether the wrapper was invoked from the old
// `_actions/.../atmos` layout or the new tool-cache layout - see
// wrapper-cache-integration.test.ts, which reproduces the same defect through
// the full production install pipeline, and this file, which isolates it to
// just "does running the compiled entry point invoke runWrapper() at all".
// Fixed by replacing the guard with a realpath comparison of
// process.argv[1]/__filename (see src/wrapper.ts).
//
// This file intentionally runs the real, committed dist/wrapper/index.js
// directly via `node`, with no installer/tool-cache involved, to prove the
// fix lives in the compiled entry point itself, not in how it gets
// installed.
const IS_WINDOWS = os.platform() === "win32";

// The fixture below is a `#!/bin/sh` script and an extensionless `atmos-bin`,
// both Unix-specific; this repo's CI only runs Jest on ubuntu-latest anyway
// (.github/workflows/main.yml `build` job), so skip on Windows rather than
// add a second fixture layout for a platform Jest never runs on in CI -
// mirrors wrapper-cache-integration.test.ts's describeUnix.
const describeUnix = IS_WINDOWS ? describe.skip : describe;

describeUnix("wrapper compiled entry point", () => {
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

    expect(stdout).toContain("REAL ATMOS RAN: terraform apply example -s test-stack");
  });
});
