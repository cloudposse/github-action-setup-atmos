import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import * as tc from "@actions/tool-cache";

import * as installer from "../installer";
import { IAtmosVersionInfo } from "../interfaces";

// Only tc.downloadTool is stubbed (network avoidance); cacheDir/find/everything
// else in @actions/tool-cache runs for real, as do @actions/core and @actions/io
// (neither is jest.mock()-ed at all in this file). This is deliberate: every
// other test in this repo mocks the whole tool-cache/io/exec surface, so no
// test has ever let a real tc.cacheDir() copy run and then actually spawned
// the resulting wrapper as a real child process.
//
// This reproduces the reported "install-wrapper" silent no-op (0s, exit 0,
// zero output) end to end through the full production install pipeline
// (install -> real tc.cacheDir copy -> real child-process exec). The second
// test below ("spawns the cached wrapper...") is the actual reproduction:
// it fails today with empty stdout and exit code 0. The root cause turns out
// to be unrelated to tool-cache copy semantics (the first test below shows
// the copy preserves file presence/permissions just fine) - it's that
// dist/wrapper/index.js's `if (require.main === module)` entry guard
// evaluates to false once bundled by @vercel/ncc, so runWrapper() is never
// invoked at all when the wrapper is run as a script. See
// wrapper-entrypoint.test.ts, which isolates that specific defect without
// any tool-cache/installer involvement.
jest.mock("@actions/tool-cache", () => ({
  ...jest.requireActual("@actions/tool-cache"),
  downloadTool: jest.fn()
}));

const IS_WINDOWS = os.platform() === "win32";

// Windows wrapper installs use atmos-wrapper.js + atmos.cmd (a different file
// layout than Unix's single executable `atmos` script), and this repo's CI
// only ever runs Jest on ubuntu-latest (.github/workflows/main.yml `build`
// job) - Windows coverage of the real action is exercised by the separate
// `integration` job against the compiled dist/, not Jest. Skip here rather
// than add a second fixture layout for a platform Jest never runs on in CI.
const describeUnix = IS_WINDOWS ? describe.skip : describe;

describeUnix("wrapper + real tool-cache integration (reproduces install-wrapper regression)", () => {
  const originalRunnerToolCache = process.env.RUNNER_TOOL_CACHE;

  let runnerToolCacheDir: string;
  let fixtureDir: string;
  let atmosInstallPath: string;

  beforeEach(() => {
    runnerToolCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "atmos-tool-cache-"));
    process.env.RUNNER_TOOL_CACHE = runnerToolCacheDir;

    // A real, on-disk, executable "fake atmos-bin" fixture that stands in for
    // the downloaded atmos binary, so we never hit the network.
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "atmos-fixture-"));
    const fixturePath = path.join(fixtureDir, "fake-atmos");
    fs.writeFileSync(fixturePath, '#!/bin/sh\necho "REAL ATMOS RAN: $*"\nexit 0\n', "utf8");
    fs.chmodSync(fixturePath, 0o775);

    (tc.downloadTool as jest.Mock).mockResolvedValue(fixturePath);

    // installAtmosVersion derives its install dir from its own __dirname and
    // is not injectable; this is the same fixed, real (non-temp) path the
    // existing mocked tests in setup-atmos.test.ts compute but never
    // actually write to. This test is the first to write real files here,
    // so it must clean up explicitly.
    const repoParent = path.resolve(__dirname, "..", "..", "..");
    atmosInstallPath = path.join(repoParent, "atmos");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(runnerToolCacheDir, { recursive: true, force: true });
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(atmosInstallPath, { recursive: true, force: true });

    if (originalRunnerToolCache === undefined) {
      delete process.env.RUNNER_TOOL_CACHE;
    } else {
      process.env.RUNNER_TOOL_CACHE = originalRunnerToolCache;
    }
  });

  it("produces a real, complete, executable cache entry after a real tc.cacheDir() copy", async () => {
    const info: IAtmosVersionInfo = {
      downloadUrl: "https://example.test/atmos_1.222.0_linux_amd64",
      resolvedVersion: "v1.222.0",
      fileName: "atmos_1.222.0_linux_amd64"
    };

    // Real installAtmosVersion: real io.cp, real fs.chmodSync, real
    // installWrapperBin writing the real committed dist/wrapper/index.js.
    const installedPath = await installer.installAtmosVersion(info, undefined, "x64", true, "skip");
    expect(installedPath).toEqual(atmosInstallPath);

    // Real tc.cacheDir(), exactly as getAtmos() does on a fresh install.
    const cachedDir = await tc.cacheDir(installedPath, "atmos-wrapper", info.resolvedVersion, "x64");

    const cachedWrapperPath = path.join(cachedDir, "atmos");
    const cachedBinPath = path.join(cachedDir, "atmos-bin");

    expect(fs.existsSync(cachedWrapperPath)).toBe(true);
    expect(fs.existsSync(cachedBinPath)).toBe(true);
    expect(fs.existsSync(`${cachedDir}.complete`)).toBe(true);

    // Executable bit survived the real copy (X_OK check avoids asserting
    // exact, umask-dependent mode bits).
    expect(() => fs.accessSync(cachedWrapperPath, fs.constants.X_OK)).not.toThrow();
    expect(() => fs.accessSync(cachedBinPath, fs.constants.X_OK)).not.toThrow();
  });

  it("spawns the cached wrapper as a real child process and gets real atmos output", async () => {
    const info: IAtmosVersionInfo = {
      downloadUrl: "https://example.test/atmos_1.222.0_linux_amd64",
      resolvedVersion: "v1.222.0",
      fileName: "atmos_1.222.0_linux_amd64"
    };

    const installedPath = await installer.installAtmosVersion(info, undefined, "x64", true, "skip");
    const cachedDir = await tc.cacheDir(installedPath, "atmos-wrapper", info.resolvedVersion, "x64");
    const cachedWrapperPath = path.join(cachedDir, "atmos");

    // Scope ATMOS_CLI_PATH to the child process only - never mutate the test
    // process's own process.env (which core.exportVariable/addPath would do
    // for real if called, and which would leak across test files sharing a
    // Jest worker).
    let stdout: string;
    try {
      stdout = execFileSync(cachedWrapperPath, ["terraform", "apply", "example", "-s", "test-stack"], {
        env: { ...process.env, ATMOS_CLI_PATH: cachedDir },
        encoding: "utf8",
        timeout: 10_000
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
      throw new Error(
        `cached wrapper failed: status=${e.status} stdout=${e.stdout ?? ""} stderr=${e.stderr ?? ""} (${e.message})`
      );
    }

    expect(stdout).toContain("REAL ATMOS RAN: terraform apply example -s test-stack");
  });
});
