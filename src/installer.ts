import fs, { readFileSync, writeFileSync } from "fs";
import os from "os";
import * as path from "path";

import * as core from "@actions/core";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import { Octokit } from "octokit";
import * as semver from "semver";

import { getAtmosBinaryName, getAtmosWrappedBinaryName } from "./atmos-bin";
import {
  IAtmosVersionInfo,
  IAtmosVersion,
  IAtmosVersionFile,
} from "./interfaces";
import * as sys from "./system";

//
// Convert version syntax into semver for semver matching
// 1.13.1 => 1.13.1
// 1.13 => 1.13.0
// 1.10beta1 => 1.10.0-beta.1, 1.10rc1 => 1.10.0-rc.1
// 1.8.5beta1 => 1.8.5-beta.1, 1.8.5rc1 => 1.8.5-rc.1
export const makeSemver = (version: string): string => {
  version = version.replace("beta", "-beta.").replace("rc", "-rc.");
  const parts = version.split("-");

  const semVersion = semver.coerce(parts[0])?.version;
  if (!semVersion) {
    throw new Error(
      `The version: ${version} can't be changed to SemVer notation`
    );
  }

  if (!parts[1]) {
    return semVersion;
  }

  const fullVersion = semver.valid(`${semVersion}-${parts[1]}`);

  if (!fullVersion) {
    throw new Error(
      `The version: ${version} can't be changed to SemVer notation`
    );
  }
  return fullVersion;
};

export const findVersionMatch = (
  versionSpec: string,
  arch = os.arch(),
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

    core.debug(`check ${version} satisfies ${versionSpec}`);
    if (semver.satisfies(version, versionSpec) || versionSpec == "latest") {
      atmosFile = candidate.assets.find((file) => {
        core.debug(
          `${file.arch}===${archFilter} && ${file.os}===${platFilter}`
        );

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

export const getVersionsFromGitHubReleases = async (
  auth: string | undefined
): Promise<IAtmosVersion[] | null> => {
  const octokit = new Octokit({ auth });

  const versions: IAtmosVersion[] = [];
  for await (const release of octokit.paginate.iterator(
    octokit.rest.repos.listReleases,
    {
      owner: "cloudposse",
      repo: "atmos",
    }
  )) {
    release.data.forEach((r) => {
      const { tag_name, prerelease } = r;
      if (!tag_name) {
        throw new Error(`Release tag is empty`);
      }

      const assets = r.assets.map((asset) => {
        const { name, browser_download_url } = asset;
        const parts = asset.name.split("_");
        const os = parts[2];
        const arch = parts[3];

        return { name, os, arch, browser_download_url };
      });

      const version: IAtmosVersion = { name: tag_name, prerelease, assets };
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
  const candidates: IAtmosVersion[] | null =
    await getVersionsFromGitHubReleases(auth);

  const version: IAtmosVersion | undefined = findVersionMatch(
    versionSpec,
    arch,
    candidates
  );
  if (!version) {
    return null;
  }

  return <IAtmosVersionInfo>{
    downloadUrl: version.assets[0].browser_download_url,
    resolvedVersion: version.name,
    fileName: version.assets[0].name,
  };
};

export const installWrapperBin = async (
  atmosDownloadPath: string
): Promise<string> => {
  let source = "";
  let destination = "";

  try {
    source = path.resolve(
      [__dirname, "..", "dist", "wrapper", "index.js"].join(path.sep)
    );
    destination = [atmosDownloadPath, "atmos"].join(path.sep);

    core.info(`Installing wrapper script from ${source} to ${destination}.`);

    const orig = readFileSync(source, "utf8");
    const contents = `#!/usr/bin/env node\n\n${orig}`;
    //await io.cp(source, destination);
    await writeFileSync(destination, contents, "utf8");
    fs.chmodSync(destination, 0o775);

    // This is a hack to fix the line ending of the shebang, which for some unknown reason is being written as CR
    // rather than LF

    // Export a new environment variable, so our wrapper can locate the binary
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
  installWrapper: boolean
): Promise<string> => {
  const atmosBinName = installWrapper
    ? getAtmosWrappedBinaryName()
    : getAtmosBinaryName();

  const homeDir = path.resolve([__dirname, "..", ".."].join(path.sep));
  const atmosInstallPath = [homeDir, "atmos"].join(path.sep);

  core.info(`Acquiring ${info.resolvedVersion} from ${info.downloadUrl}`);
  const downloadPath = await tc.downloadTool(info.downloadUrl, undefined, auth);
  const toolPath = path.join(atmosInstallPath, atmosBinName);

  core.info("Renaming downloaded file...");
  await io.mv(downloadPath, toolPath);
  core.info(`Successfully renamed atmos from ${downloadPath} to ${toolPath}`);

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
  arch = os.arch(),
  installWrapper: boolean
): Promise<{ toolPath: string; info: IAtmosVersionInfo | null }> => {
  const osPlat: string = os.platform();

  // check cache
  let toolPath: string;
  toolPath = tc.find("atmos", versionSpec, arch);

  // If not found in cache, download
  if (toolPath) {
    core.info(`Found in cache @ ${toolPath}`);
    return { toolPath, info: null };
  }

  core.info(`Attempting to download ${versionSpec}...`);
  let info: IAtmosVersionInfo | null = null;

  info = await getMatchingVersion(versionSpec, auth, arch);
  if (!info) {
    throw new Error(
      `Unable to find Atmos version '${versionSpec}' for platform ${osPlat} and architecture ${arch}.`
    );
  }

  try {
    core.info(`Installing version ${info.resolvedVersion} from GitHub`);
    toolPath = await installAtmosVersion(info, undefined, arch, installWrapper);

    if (osPlat != "win32") {
      toolPath = path.join(toolPath);
    }

    core.addPath(toolPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    core.setFailed(err);
  }

  return { toolPath, info };
};
