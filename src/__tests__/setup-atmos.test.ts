import fs from "fs";
import os from "os";
import path from "path";

import * as core from "@actions/core";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";

import * as installer from "../installer";
import { IAtmosVersion, IAtmosVersionInfo } from "../interfaces";
import { run } from "../main";
import * as sys from "../system";

const mockPaginateIterator = jest.fn();

jest.mock("@actions/core");
jest.mock("@actions/io");
jest.mock("@actions/tool-cache");
jest.mock("octokit", () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    paginate: {
      iterator: mockPaginateIterator
    },
    rest: {
      repos: {
        listReleases: jest.fn()
      }
    }
  }))
}));

const repoParent = path.resolve(__dirname, "..", "..", "..");
const atmosInstallPath = path.join(repoParent, "atmos");

const mockReadFileSync = (implementation: (filePath: fs.PathOrFileDescriptor) => string | Buffer) => {
  jest.spyOn(fs, "readFileSync").mockImplementation(implementation as unknown as typeof fs.readFileSync);
};

const versionInfo: IAtmosVersionInfo = {
  downloadUrl: "https://example.test/atmos",
  resolvedVersion: "v1.222.0",
  fileName: "atmos_1.222.0_linux_amd64"
};

const versionInfoWithChecksum: IAtmosVersionInfo = {
  ...versionInfo,
  checksumsUrl: "https://example.test/atmos_1.222.0_SHA256SUMS"
};

const releaseCandidates: IAtmosVersion[] = [
  {
    name: "v1.222.0",
    prerelease: false,
    assets: [
      {
        name: "atmos_1.222.0_linux_amd64",
        os: "linux",
        arch: "amd64",
        browser_download_url: "https://example.test/linux"
      },
      {
        name: "atmos_1.222.0_darwin_amd64",
        os: "darwin",
        arch: "amd64",
        browser_download_url: "https://example.test/darwin"
      },
      {
        name: "atmos_1.222.0_windows_amd64.exe",
        os: "windows",
        arch: "amd64",
        browser_download_url: "https://example.test/windows"
      }
    ]
  }
];

const githubRelease = {
  tag_name: "v1.222.0",
  prerelease: false,
  assets: [
    ...releaseCandidates[0].assets.map((asset) => ({
      name: asset.name,
      browser_download_url: asset.browser_download_url
    })),
    {
      name: "atmos_1.222.0_SHA256SUMS",
      browser_download_url: "https://example.test/checksums"
    }
  ]
};

const mockPlatform = (platform: NodeJS.Platform) => {
  jest.spyOn(os, "platform").mockReturnValue(platform);
};

const setupInstallSpies = (platform: NodeJS.Platform, downloadPath = "downloaded-atmos") => {
  mockPlatform(platform);
  jest.spyOn(fs, "chmodSync").mockReturnValue();
  jest.spyOn(fs, "readFileSync").mockReturnValue("compiled wrapper");
  jest.spyOn(fs, "writeFileSync").mockReturnValue();
  jest.spyOn(tc, "downloadTool").mockResolvedValue(downloadPath);
  jest.spyOn(io, "mkdirP").mockResolvedValue();
  jest.spyOn(io, "cp").mockResolvedValue();
  jest.spyOn(io, "rmRF").mockResolvedValue();
};

describe("Setup Atmos", () => {
  beforeEach(() => {
    mockPaginateIterator.mockImplementation(async function* paginateReleases() {
      yield { data: [githubRelease] };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("release assets", () => {
    it.each`
      version              | expected
      ${"1.10beta1"}      | ${"1.10.0-beta.1"}
      ${"1.10rc1"}        | ${"1.10.0-rc.1"}
      ${"v1.222.0-rc.1"}  | ${"1.222.0-rc.1"}
    `("normalizes $version to semver", ({ version, expected }) => {
      expect(installer.makeSemver(version)).toEqual(expected);
    });

    it("rejects versions that cannot be coerced to semver", () => {
      expect(() => installer.makeSemver("not-a-version")).toThrow("can't be changed to SemVer notation");
    });

    it.each`
      assetName                            | expectedOs   | expectedArch
      ${"atmos_1.222.0_linux_amd64"}       | ${"linux"}   | ${"amd64"}
      ${"atmos_1.222.0_darwin_amd64"}      | ${"darwin"}  | ${"amd64"}
      ${"atmos_1.222.0_windows_amd64.exe"} | ${"windows"} | ${"amd64"}
    `("parses $assetName", ({ assetName, expectedOs, expectedArch }) => {
      expect(installer.parseAtmosReleaseAsset(assetName, "https://example.test")).toEqual({
        name: assetName,
        os: expectedOs,
        arch: expectedArch,
        browser_download_url: "https://example.test"
      });
    });

    it("ignores non-binary assets", () => {
      expect(
        installer.parseAtmosReleaseAsset("atmos_1.222.0_SHA256SUMS", "https://example.test/checksums")
      ).toBeUndefined();
    });

    it.each`
      assetName
      ${"atmos_1.222.0_windows_amd64"}
      ${"atmos_1.222.0_linux_amd64.exe"}
      ${"terraform_1.222.0_linux_amd64"}
    `("rejects malformed asset $assetName", ({ assetName }) => {
      expect(installer.parseAtmosReleaseAsset(assetName, "https://example.test")).toBeUndefined();
    });

    it.each`
      platform    | expectedUrl
      ${"linux"}  | ${"https://example.test/linux"}
      ${"darwin"} | ${"https://example.test/darwin"}
      ${"win32"}  | ${"https://example.test/windows"}
    `("matches x64 assets on $platform", ({ platform, expectedUrl }) => {
      mockPlatform(platform as NodeJS.Platform);

      const match = installer.findVersionMatch("latest", "x64", releaseCandidates);

      expect(match?.assets).toHaveLength(1);
      expect(match?.assets[0].browser_download_url).toEqual(expectedUrl);
      expect(match?.assets[0].arch).toEqual("amd64");
    });

    it("throws when release candidates are missing", () => {
      expect(() => installer.findVersionMatch("latest", "x64", null)).toThrow("did not return results");
    });

    it("returns undefined when no matching platform asset exists", () => {
      mockPlatform("linux");

      expect(installer.findVersionMatch("latest", "arm64", releaseCandidates)).toBeUndefined();
    });

    it("maps GitHub releases to binary assets plus checksum URLs", async () => {
      const versions = await installer.getVersionsFromGitHubReleases(undefined);

      expect(versions).toEqual([
        {
          name: "v1.222.0",
          prerelease: false,
          checksumsUrl: "https://example.test/checksums",
          assets: releaseCandidates[0].assets
        }
      ]);
    });

    it("returns resolved version info with checksum URL", async () => {
      mockPlatform("linux");

      await expect(installer.getMatchingVersion("latest", undefined, "x64")).resolves.toEqual({
        downloadUrl: "https://example.test/linux",
        resolvedVersion: "v1.222.0",
        fileName: "atmos_1.222.0_linux_amd64",
        checksumsUrl: "https://example.test/checksums"
      });
    });
  });

  describe("checksum verification", () => {
    it.each`
      input        | expected
      ${undefined} | ${"warn"}
      ${""}        | ${"warn"}
      ${"warn"}    | ${"warn"}
      ${"enforce"} | ${"enforce"}
      ${"skip"}    | ${"skip"}
      ${" SKIP "}  | ${"skip"}
    `("parses checksum-validation mode $input", ({ input, expected }) => {
      expect(installer.parseChecksumValidationMode(input)).toEqual(expected);
    });

    it("rejects invalid checksum-validation modes", () => {
      expect(() => installer.parseChecksumValidationMode("strict")).toThrow("Invalid checksum-validation mode");
    });

    it("parses the expected checksum for an asset", () => {
      expect(
        installer.getExpectedChecksum(
          [
            "3ce47285a8f4a23a5a9019f0f82fe41239ae23a526bb8e3edcec0d977bccd690  atmos_1.222.0_darwin_amd64",
            "5e488513434def59814045ca533797b9af6752757f6c2ade96c0a643e5baa8c3  atmos_1.222.0_linux_amd64"
          ].join("\n"),
          "atmos_1.222.0_linux_amd64"
        )
      ).toEqual("5e488513434def59814045ca533797b9af6752757f6c2ade96c0a643e5baa8c3");
    });

    it("rejects missing checksum entries", () => {
      expect(() => installer.getExpectedChecksum("", "atmos_1.222.0_linux_amd64")).toThrow(
        "Unable to find checksum"
      );
    });

    it("rejects invalid checksum entries", () => {
      expect(() => installer.getExpectedChecksum("not-a-sha  atmos_1.222.0_linux_amd64", "atmos_1.222.0_linux_amd64"))
        .toThrow("Invalid SHA256 checksum");
    });

    it("verifies a downloaded file against SHA256SUMS", () => {
      mockReadFileSync((filePath) => {
        if (filePath === "checksums") {
          return "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5  atmos_1.222.0_linux_amd64";
        }

        return Buffer.from("payload");
      });

      installer.verifyChecksum("downloaded-atmos", "checksums", "atmos_1.222.0_linux_amd64");

      expect(core.info).toHaveBeenCalledWith("Verified SHA256 checksum for atmos_1.222.0_linux_amd64.");
    });

    it("rejects checksum mismatches", () => {
      mockReadFileSync((filePath) => {
        if (filePath === "checksums") {
          return "0000000000000000000000000000000000000000000000000000000000000000  atmos_1.222.0_linux_amd64";
        }

        return Buffer.from("payload");
      });

      expect(() => installer.verifyChecksum("downloaded-atmos", "checksums", "atmos_1.222.0_linux_amd64")).toThrow(
        "Checksum mismatch"
      );
    });
  });

  describe("install paths", () => {
    it.each`
      platform    | installWrapper | expectedBinary
      ${"linux"}  | ${false}       | ${"atmos"}
      ${"darwin"} | ${false}       | ${"atmos"}
      ${"win32"}  | ${false}       | ${"atmos.exe"}
      ${"linux"}  | ${true}        | ${"atmos-bin"}
      ${"darwin"} | ${true}        | ${"atmos-bin"}
      ${"win32"}  | ${true}        | ${"atmos-bin.exe"}
    `(
      "installs native binary on $platform with wrapper=$installWrapper",
      async ({ platform, installWrapper, expectedBinary }) => {
        setupInstallSpies(platform as NodeJS.Platform);

        await installer.installAtmosVersion(versionInfo, "token test-token", "x64", installWrapper);

        expect(io.cp).toHaveBeenCalledWith("downloaded-atmos", path.join(atmosInstallPath, expectedBinary));
        expect(io.rmRF).toHaveBeenCalledWith("downloaded-atmos");
      }
    );

    it("verifies checksums before installing", async () => {
      setupInstallSpies("linux");
      jest.spyOn(tc, "downloadTool").mockResolvedValueOnce("downloaded-atmos").mockResolvedValueOnce("checksums");
      mockReadFileSync((filePath) => {
        if (filePath === "checksums") {
          return "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5  atmos_1.222.0_linux_amd64";
        }

        return Buffer.from("payload");
      });

      await installer.installAtmosVersion(versionInfoWithChecksum, "token test-token", "x64", false);

      expect(tc.downloadTool).toHaveBeenCalledWith("https://example.test/atmos", undefined, "token test-token");
      expect(tc.downloadTool).toHaveBeenCalledWith(
        "https://example.test/atmos_1.222.0_SHA256SUMS",
        undefined,
        "token test-token"
      );
      expect(io.rmRF).toHaveBeenCalledWith("checksums");
      expect(io.cp).toHaveBeenCalledWith("downloaded-atmos", path.join(atmosInstallPath, "atmos"));
    });

    it("removes the downloaded file when checksum verification fails", async () => {
      setupInstallSpies("linux");
      jest.spyOn(tc, "downloadTool").mockResolvedValueOnce("downloaded-atmos").mockResolvedValueOnce("checksums");
      mockReadFileSync((filePath) => {
        if (filePath === "checksums") {
          return "0000000000000000000000000000000000000000000000000000000000000000  atmos_1.222.0_linux_amd64";
        }

        return Buffer.from("payload");
      });

      await expect(
        installer.installAtmosVersion(versionInfoWithChecksum, "token test-token", "x64", false)
      ).rejects.toThrow("Checksum mismatch");

      expect(io.rmRF).toHaveBeenCalledWith("checksums");
      expect(io.rmRF).toHaveBeenCalledWith("downloaded-atmos");
      expect(io.cp).not.toHaveBeenCalled();
    });

    it("skips checksum verification when configured", async () => {
      setupInstallSpies("linux");

      await installer.installAtmosVersion(versionInfoWithChecksum, undefined, "x64", false, "skip");

      expect(tc.downloadTool).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith("Skipping checksum verification for atmos_1.222.0_linux_amd64.");
    });

    it("warns when checksum assets are missing by default", async () => {
      setupInstallSpies("linux");

      await installer.installAtmosVersion(versionInfo, undefined, "x64", false);

      expect(core.warning).toHaveBeenCalledWith(
        "No SHA256SUMS asset found for v1.222.0; skipping checksum verification."
      );
    });

    it("fails when checksum assets are missing in enforce mode", async () => {
      setupInstallSpies("linux");

      await expect(installer.installAtmosVersion(versionInfo, undefined, "x64", false, "enforce")).rejects.toThrow(
        "No SHA256SUMS asset found"
      );
    });

    it("installs the Unix wrapper command as atmos", async () => {
      setupInstallSpies("linux");

      await installer.installAtmosVersion(versionInfo, undefined, "x64", true);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(atmosInstallPath, "atmos"),
        "#!/usr/bin/env node\n\ncompiled wrapper",
        "utf8"
      );
      expect(fs.chmodSync).toHaveBeenCalledWith(path.join(atmosInstallPath, "atmos"), 0o775);
      expect(core.exportVariable).toHaveBeenCalledWith("ATMOS_CLI_PATH", atmosInstallPath);
    });

    it("installs the Windows wrapper JavaScript and command shim", async () => {
      setupInstallSpies("win32");

      await installer.installAtmosVersion(versionInfo, undefined, "x64", true);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(atmosInstallPath, "atmos-wrapper.js"),
        "compiled wrapper",
        "utf8"
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(atmosInstallPath, "atmos.cmd"),
        '@echo off\r\nnode "%~dp0atmos-wrapper.js" %*\r\n',
        "utf8"
      );
      expect(core.exportVariable).toHaveBeenCalledWith("ATMOS_CLI_PATH", atmosInstallPath);
    });
  });

  describe("tool cache", () => {
    beforeEach(() => {
      mockPlatform("linux");
      jest.spyOn(tc, "find").mockReturnValue("/cache/atmos");
    });

    it("uses the native cache namespace without wrapper", async () => {
      await installer.getAtmos("latest", undefined, "x64", false);

      expect(tc.find).toHaveBeenCalledWith("atmos-native", "v1.222.0", "x64");
      expect(core.addPath).toHaveBeenCalledWith("/cache/atmos");
      expect(core.exportVariable).not.toHaveBeenCalled();
    });

    it("uses a separate cache namespace with wrapper", async () => {
      await installer.getAtmos("latest", undefined, "x64", true);

      expect(tc.find).toHaveBeenCalledWith("atmos-wrapper", "v1.222.0", "x64");
      expect(core.exportVariable).toHaveBeenCalledWith("ATMOS_CLI_PATH", "/cache/atmos");
      expect(core.addPath).toHaveBeenCalledWith("/cache/atmos");
    });

    it("installs and caches when no cached tool exists", async () => {
      jest.spyOn(tc, "find").mockReturnValue("");
      jest.spyOn(tc, "cacheDir").mockResolvedValue("/cache/atmos");
      jest.spyOn(tc, "downloadTool").mockResolvedValueOnce("downloaded-atmos").mockResolvedValueOnce("checksums");
      jest.spyOn(io, "mkdirP").mockResolvedValue();
      jest.spyOn(io, "cp").mockResolvedValue();
      jest.spyOn(io, "rmRF").mockResolvedValue();
      jest.spyOn(fs, "chmodSync").mockReturnValue();
      mockReadFileSync((filePath) => {
        if (filePath === "checksums") {
          return "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5  atmos_1.222.0_linux_amd64";
        }

        return Buffer.from("payload");
      });

      await installer.getAtmos("latest", "token test-token", "x64", false, "warn");

      expect(tc.cacheDir).toHaveBeenCalledWith(atmosInstallPath, "atmos-native", "v1.222.0", "x64");
      expect(core.addPath).toHaveBeenCalledWith("/cache/atmos");
    });
  });

  describe("run", () => {
    it("sets the resolved version output", async () => {
      jest
        .spyOn(core, "getInput")
        .mockReturnValueOnce("latest")
        .mockReturnValueOnce("")
        .mockReturnValueOnce("false")
        .mockReturnValueOnce("");
      jest.spyOn(os, "arch").mockReturnValue("x64");
      jest.spyOn(installer, "getAtmos").mockResolvedValue({
        toolPath: "/cache/atmos",
        info: versionInfo
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith("atmos-version", "v1.222.0");
    });

    it("fails the action when setup throws", async () => {
      jest
        .spyOn(core, "getInput")
        .mockReturnValueOnce("latest")
        .mockReturnValueOnce("")
        .mockReturnValueOnce("true")
        .mockReturnValueOnce("");
      jest.spyOn(os, "arch").mockReturnValue("x64");
      jest.spyOn(installer, "getAtmos").mockRejectedValue(new Error("boom"));

      await run();

      expect(core.setFailed).toHaveBeenCalledWith("boom");
    });

    it("passes token auth and checksum-validation through to the installer", async () => {
      jest
        .spyOn(core, "getInput")
        .mockReturnValueOnce("latest")
        .mockReturnValueOnce("arm64")
        .mockReturnValueOnce("true")
        .mockReturnValueOnce("enforce")
        .mockReturnValueOnce("github-token");
      jest.spyOn(installer, "getAtmos").mockResolvedValue({
        toolPath: "/cache/atmos",
        info: versionInfo
      });

      await run();

      expect(installer.getAtmos).toHaveBeenCalledWith("latest", "token github-token", "arm64", true, "enforce");
    });
  });

  describe("system helpers", () => {
    it.each`
      arch       | expected
      ${"x64"}   | ${"amd64"}
      ${"x32"}   | ${"386"}
      ${"arm"}   | ${"armv6l"}
      ${"arm64"} | ${"arm64"}
    `("maps $arch to $expected", ({ arch, expected }) => {
      expect(sys.getArch(arch)).toEqual(expected);
    });

    it("normalizes Windows platforms", () => {
      mockPlatform("win32");

      expect(sys.isWindows()).toEqual(true);
      expect(sys.getPlatform()).toEqual("windows");
    });
  });
});
