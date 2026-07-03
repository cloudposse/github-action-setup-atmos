import crypto from "crypto";
import fs, { readFileSync, writeFileSync } from "fs";
import os from "os";
import * as path from "path";

import * as core from "@actions/core";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import { Octokit } from "octokit";
import * as semver from "semver";

import { getAtmosBinaryName, getAtmosWrappedBinaryName } from "./atmos-bin";
import { ChecksumValidationMode, IAtmosVersionInfo, IAtmosVersion, IAtmosVersionFile } from "./interfaces";
import * as sys from "./system";

const WRAPPED_TOOL_CACHE_NAME = "atmos-wrapper";
const UNWRAPPED_TOOL_CACHE_NAME = "atmos-native";
const WINDOWS_WRAPPER_NAME = "atmos-wrapper.js";
const WINDOWS_COMMAND_SHIM_NAME = "atmos.cmd";

const getChecksumsAssetName = (tagName: string): string => `atmos_${tagName.replace(/^v/, "")}_SHA256SUMS`;
const CHECKSUM_VALIDATION_MODES: ChecksumValidationMode[] = ["warn", "enforce", "skip"];

//
// Convert version syntax into semver for semver matching
// 1.13.1 => 1.13.1
// 1.13 => 1.13.0
// 1.10beta1 => 1.10.0-beta.1, 1.10rc1 => 1.10.0-rc.1
// 1.8.5beta1 => 1.8.5-beta.1, 1.8.5rc1 => 1.8.5-rc.1
// 1.172.0-rc.1 => 1.172.0-rc.1
export const makeSemver = (version: string): string => {
  version = version.replace("beta", "-beta.").replace("rc", "-rc.").replace("--", "-").replace("..", ".");

  const parts = version.split("-");

  const semVersion = semver.coerce(parts[0])?.version;
  if (!semVersion) {
    throw new Error(`The version: ${version} can't be changed to SemVer notation`);
  }

  if (!parts[1]) {
    return semVersion;
  }

  const fullVersion = semver.valid(`${semVersion}-${parts[1]}`);

  if (!fullVersion) {
    throw new Error(`The version: ${version} can't be changed to SemVer notation`);
  }
  return fullVersion;
};

export const parseAtmosReleaseAsset = (
  assetName: string,
  browserDownloadUrl: string
): IAtmosVersionFile | undefined => {
  const match = assetName.match(/^atmos_(.+)_(darwin|freebsd|linux|windows)_([^.]+?)(\.exe)?$/);

  if (!match) {
    return undefined;
  }

  const [, , assetOs, assetArch, extension] = match;
  if ((assetOs === "windows") !== (extension === ".exe")) {
    return undefined;
  }

  return {
    name: assetName,
    os: assetOs,
    arch: assetArch,
    browser_download_url: browserDownloadUrl
  };
};

export const parseChecksumValidationMode = (mode: string | undefined): ChecksumValidationMode => {
  const normalizedMode = mode?.trim().toLowerCase() || "warn";

  if (!CHECKSUM_VALIDATION_MODES.includes(normalizedMode as ChecksumValidationMode)) {
    throw new Error(`Invalid checksum-validation mode '${mode}'. Expected one of: warn, enforce, skip.`);
  }

  return normalizedMode as ChecksumValidationMode;
};

const getToolCacheName = (installWrapper: boolean): string =>
  installWrapper ? WRAPPED_TOOL_CACHE_NAME : UNWRAPPED_TOOL_CACHE_NAME;

const configureInstalledPath = (toolPath: string, installWrapper: boolean) => {
  if (installWrapper) {
    core.exportVariable("ATMOS_CLI_PATH", toolPath);
  }
  core.addPath(toolPath);
};

export const getExpectedChecksum = (checksums: string, fileName: string): string => {
  const checksumLine = checksums
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(` ${fileName}`) || line.endsWith(` *${fileName}`));

  if (!checksumLine) {
    throw new Error(`Unable to find checksum for ${fileName}.`);
  }

  const [checksum] = checksumLine.split(/\s+/);
  if (!/^[a-fA-F0-9]{64}$/.test(checksum)) {
    throw new Error(`Invalid SHA256 checksum for ${fileName}.`);
  }

  return checksum.toLowerCase();
};

export const verifyChecksum = (filePath: string, checksumsPath: string, fileName: string) => {
  const expectedChecksum = getExpectedChecksum(readFileSync(checksumsPath, "utf8"), fileName);
  const actualChecksum = crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");

  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum mismatch for ${fileName}.`);
  }

  core.info(`Verified SHA256 checksum for ${fileName}.`);
};

const verifyDownloadedTool = async (
  info: IAtmosVersionInfo,
  downloadPath: string,
  auth: string | undefined,
  checksumValidation: ChecksumValidationMode
): Promise<void> => {
  if (checksumValidation === "skip") {
    core.info(`Skipping checksum verification for ${info.fileName}.`);
    return;
  }

  if (!info.checksumsUrl) {
    const message = `No SHA256SUMS asset found for ${info.resolvedVersion}; skipping checksum verification.`;
    if (checksumValidation === "enforce") {
      throw new Error(message);
    }

    core.warning(message);
    return;
  }

  const checksumsPath = await tc.downloadTool(info.checksumsUrl, undefined, auth);
  try {
    verifyChecksum(downloadPath, checksumsPath, info.fileName);
  } finally {
    await io.rmRF(checksumsPath);
  }
};

export const findVersionMatch = (
  versionSpec: string,
  arch: string = os.arch(),
  candidates: IAtmosVersion[] | null
): IAtmosVersion | undefined => {
  const archFilter = sys.getArch(arch);
  const platFilter = sys.getPlatform();

  let result: IAtmosVersion | undefined;
  let match: IAtmosVersion | undefined;

  if (!candidates) {
    throw new Error(`atmos download url did not return results`);
  }

  let atmosFile: IAtmosVersionFile | undefined;
  for (let i = 0; i < candidates.length; i++) {
    const candidate: IAtmosVersion = candidates[i];
    const version = makeSemver(candidate.name);

    core.debug(`[${candidate.name}] check ${version} satisfies ${versionSpec}`);
    if (semver.satisfies(version, versionSpec) || (versionSpec == "latest" && !candidate.prerelease)) {
      atmosFile = candidate.assets.find((file) => {
        core.debug(`${file.arch}===${archFilter} && ${file.os}===${platFilter}`);

        return file.arch === archFilter && file.os === platFilter;
      });

      if (atmosFile) {
        core.debug(`matched ${candidate.name}`);
        match = candidate;
        break;
      }
    }
  }

  if (match && atmosFile) {
    result = <IAtmosVersion>Object.assign({}, match);
    result.assets = [atmosFile];
  }

  return result;
};

export const getVersionsFromGitHubReleases = async (auth: string | undefined): Promise<IAtmosVersion[] | null> => {
  const octokit = new Octokit({ auth });

  const versions: IAtmosVersion[] = [];
  for await (const release of octokit.paginate.iterator(octokit.rest.repos.listReleases, {
    owner: "cloudposse",
    repo: "atmos"
  })) {
    release.data.forEach((r) => {
      const { tag_name, prerelease } = r;
      if (!tag_name) {
        throw new Error(`Release tag is empty`);
      }

      const assets = r.assets.flatMap((asset) => {
        const { name, browser_download_url } = asset;
        const atmosAsset = parseAtmosReleaseAsset(name, browser_download_url);

        return atmosAsset ? [atmosAsset] : [];
      });
      const checksumsUrl = r.assets.find(
        (asset) => asset.name === getChecksumsAssetName(tag_name)
      )?.browser_download_url;

      const version: IAtmosVersion = { name: tag_name, prerelease, assets, checksumsUrl };
      versions.push(version);
    });
  }
  return versions;
};

export const getMatchingVersion = async (
  versionSpec: string,
  auth: string | undefined,
  arch: string
): Promise<IAtmosVersionInfo | null> => {
  const candidates: IAtmosVersion[] | null = await getVersionsFromGitHubReleases(auth);

  const version: IAtmosVersion | undefined = findVersionMatch(versionSpec, arch, candidates);
  if (!version) {
    return null;
  }

  return <IAtmosVersionInfo>{
    downloadUrl: version.assets[0].browser_download_url,
    resolvedVersion: version.name,
    fileName: version.assets[0].name,
    checksumsUrl: version.checksumsUrl
  };
};

export const installWrapperBin = async (atmosDownloadPath: string): Promise<string> => {
  let source = "";
  let destination = "";

  try {
    source = path.resolve([__dirname, "..", "dist", "wrapper", "index.js"].join(path.sep));
    const orig = readFileSync(source, "utf8");

    if (sys.isWindows()) {
      destination = path.join(atmosDownloadPath, WINDOWS_WRAPPER_NAME);
      const shimDestination = path.join(atmosDownloadPath, WINDOWS_COMMAND_SHIM_NAME);

      core.info(`Installing wrapper script from ${source} to ${destination}.`);
      writeFileSync(destination, orig, "utf8");

      core.info(`Installing Windows command shim to ${shimDestination}.`);
      writeFileSync(shimDestination, `@echo off\r\nnode "%~dp0${WINDOWS_WRAPPER_NAME}" %*\r\n`, "utf8");
    } else {
      destination = path.join(atmosDownloadPath, "atmos");

      core.info(`Installing wrapper script from ${source} to ${destination}.`);

      // This is a hack to fix the line ending of the shebang, which for some unknown reason is being written as CR
      // rather than LF
      //
      // await io.cp(source, destination);
      const contents = `#!/usr/bin/env node\n\n${orig}`;
      writeFileSync(destination, contents, "utf8");
      // end hack

      // Make the wrapper script executable
      fs.chmodSync(destination, 0o775);
    }

    core.exportVariable("ATMOS_CLI_PATH", atmosDownloadPath);

    return atmosDownloadPath;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    core.setFailed(`Unable to copy ${source} to ${destination}.`);
    throw e;
  }
};

export const installAtmosVersion = async (
  info: IAtmosVersionInfo,
  auth: string | undefined,
  arch: string,
  installWrapper: boolean,
  checksumValidation: ChecksumValidationMode = "warn"
): Promise<string> => {
  const atmosBinName = installWrapper ? getAtmosWrappedBinaryName() : getAtmosBinaryName();

  const homeDir = path.resolve([__dirname, "..", ".."].join(path.sep));
  const atmosInstallPath = [homeDir, "atmos"].join(path.sep);

  core.info(`Acquiring ${info.resolvedVersion} from ${info.downloadUrl}`);
  const downloadPath = await tc.downloadTool(info.downloadUrl, undefined, auth);
  const toolPath = path.join(atmosInstallPath, atmosBinName);

  await verifyDownloadedTool(info, downloadPath, auth, checksumValidation);

  core.info("Installing downloaded file...");
  // Ensure the destination directory exists
  await io.mkdirP(atmosInstallPath);
  // Use copy + delete instead of mv/rename to handle cross-device installations
  // This fixes EXDEV errors in Docker-in-Docker and other containerized environments
  await io.cp(downloadPath, toolPath);
  await io.rmRF(downloadPath);
  core.info(`Successfully installed atmos from ${downloadPath} to ${toolPath}`);

  fs.chmodSync(toolPath, 0o775);

  if (installWrapper) {
    await installWrapperBin(atmosInstallPath);
  }

  core.info(`Successfully installed atmos to ${atmosInstallPath}`);
  return atmosInstallPath;
};

export const getAtmos = async (
  versionSpec: string,
  auth: string | undefined,
  arch: string = os.arch(),
  installWrapper: boolean,
  checksumValidation: ChecksumValidationMode = "warn"
): Promise<{ toolPath: string; info: IAtmosVersionInfo | null }> => {
  const osPlat: string = os.platform();

  core.info(`Attempting to download ${versionSpec}...`);

  const info: IAtmosVersionInfo | null = await getMatchingVersion(versionSpec, auth, arch);
  if (!info) {
    throw new Error(`Unable to find atmos version '${versionSpec}' for platform ${osPlat} and architecture ${arch}.`);
  }

  const { resolvedVersion } = info;
  const toolCacheName = getToolCacheName(installWrapper);

  // Check to see if the version is already in the local cache
  let toolPath: string;
  toolPath = tc.find(toolCacheName, resolvedVersion, arch);

  if (toolPath) {
    core.info(`Found in cache @ ${toolPath}`);
    configureInstalledPath(toolPath, installWrapper);

    return { toolPath, info };
  }

  core.info(`Installing version ${resolvedVersion} from GitHub`);
  toolPath = await installAtmosVersion(info, auth, arch, installWrapper, checksumValidation);

  if (osPlat != "win32") {
    toolPath = path.join(toolPath);
  }

  const cachedDir = await tc.cacheDir(toolPath, toolCacheName, resolvedVersion, arch);
  core.info(`Cached version ${resolvedVersion} for ${arch} in ${cachedDir}`);

  toolPath = cachedDir;
  configureInstalledPath(toolPath, installWrapper);

  return { toolPath, info };
};
