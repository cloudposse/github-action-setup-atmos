import cp from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import * as core from "@actions/core";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import nock from "nock";

import { run } from "../main";

// By using nock.back, the first time we run the tests, we record the HTTP requests and responses sent to and from the
// GitHub API. On subsequent runs, we use the recorded responses instead of making real HTTP requests. This is much
// faster and doesn't introduce a dependency on the GitHub API.
const nockBack = nock.back;
nockBack.fixtures = `${__dirname}/../__fixtures__`;
nockBack.setMode("record");

jest.mock("@actions/core");
jest.mock("@actions/tool-cache");
jest.mock("os");

describe("Setup Atmos", () => {
  let nockDoneCb: () => void;
  beforeEach(async () => {
    // This loads a fixture from __fixtures__ that mocks the GitHub API's response to the calls made by the action.
    const { nockDone } = await nockBack("atmosReleases.json");
    nockDoneCb = nockDone;
  });

  afterEach(async () => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  const setupSpies = (
    versionSpec: string,
    expectedVersion: string,
    installWrapper = true
  ) => {
    const platform = "linux";
    const arch = "amd64";

    jest.spyOn(os, "platform").mockReturnValue(platform);
    jest.spyOn(os, "arch").mockReturnValue(arch);
    jest.spyOn(fs, "renameSync").mockReturnValue();
    jest.spyOn(fs, "chmodSync").mockReturnValue();
    jest.spyOn(cp, "execSync").mockReturnValue(expectedVersion);
    jest.spyOn(tc, "cacheDir").mockResolvedValueOnce("atmos");
    jest.spyOn(io, "mkdirP").mockResolvedValueOnce();
    jest.spyOn(io, "cp").mockResolvedValueOnce();
    jest.spyOn(io, "rmRF").mockResolvedValueOnce();

    jest
      .spyOn(tc, "downloadTool")
      .mockResolvedValueOnce(`atmos_${expectedVersion}_${platform}_${arch}`);

    jest
      .spyOn(core, "getInput")
      .mockReturnValueOnce(versionSpec) // atmos-version
      .mockReturnValueOnce("") // architecture
      .mockReturnValueOnce(installWrapper ? "true" : "false"); // install-wrapper
  };

  it.each`
    caseName                   | versionSpec       | expected
    ${"latest"}                | ${"latest"}       | ${"1.15.0"}
    ${"specific"}              | ${"1.13.0"}       | ${"1.13.0"}
    ${"less than"}             | ${"<1.13"}        | ${"1.12.2"}
    ${"less than or equal"}    | ${"<=1.13"}       | ${"1.13.5"}
    ${"greater than"}          | ${">1.13"}        | ${"1.15.0"}
    ${"greater than or equal"} | ${">=1.13"}       | ${"1.15.0"}
    ${"full"}                  | ${">1.13 <1.15"}  | ${"1.14.0"}
    ${"full with equal"}       | ${">1.13 <=1.15"} | ${"1.15.0"}
  `(
    "installs atmos with $caseName version constraint",
    async ({ versionSpec, expected }) => {
      setupSpies(versionSpec, expected);

      const setOutputMock = jest.spyOn(core, "setOutput");

      await run();
      nockDoneCb();

      expect(setOutputMock).toHaveBeenCalled();
      expect(setOutputMock).toHaveBeenCalledWith(
        "atmos-version",
        `v${expected}`
      );
    }
  );

  it("installs atmos without wrapper", async () => {
    setupSpies("latest", "1.15.0", false);

    await run();
    nockDoneCb();

    // With the fix, io.cp is called once for the binary (replacing io.mv)
    expect(io.cp).toHaveBeenCalledWith(
      "atmos_1.15.0_linux_amd64",
      [path.resolve(__dirname, "..", "..", ".."), "atmos", "atmos"].join(path.sep)
    );
    // io.rmRF should be called to clean up the temp file
    expect(io.rmRF).toHaveBeenCalledWith("atmos_1.15.0_linux_amd64");
  });

  it("installs atmos with wrapper", async () => {
    setupSpies("latest", "1.15.0", true);

    await run();
    nockDoneCb();

    // With wrapper, io.cp is called for the binary (to atmos-bin)
    expect(io.cp).toHaveBeenCalledWith(
      "atmos_1.15.0_linux_amd64",
      [path.resolve(__dirname, "..", "..", ".."), "atmos", "atmos-bin"].join(
        path.sep
      )
    );
    // io.rmRF should be called to clean up the temp file
    expect(io.rmRF).toHaveBeenCalledWith("atmos_1.15.0_linux_amd64");
  });
});

