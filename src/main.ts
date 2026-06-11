import fs from "fs";
import os from "os";

import * as core from "@actions/core";

import * as installer from "./installer";

const ATMOS_TOOL_NAME = "atmos";

// Parses `.tool-versions` content (asdf/mise format) and returns the atmos
// version, or an empty string when none is declared. Lines look like
// `atmos 1.15.0`; comments (`#`) and blank lines are ignored.
export const parseToolVersions = (content: string): string => {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const [tool, version] = trimmed.split(/\s+/);

    if (tool === ATMOS_TOOL_NAME && version) {
      return version;
    }
  }

  return "";
};

// Returns the first non-empty, non-comment line of a plain version file
// (e.g. `.atmos-version`), or an empty string when there is none.
const parsePlainVersion = (content: string): string => {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed && !trimmed.startsWith("#")) {
      return trimmed;
    }
  }

  return "";
};

// Reads an atmos version from a version file. Supports the asdf/mise
// `.tool-versions` format (an `atmos <version>` line) and a plain version file
// whose contents are the version string (e.g. `.atmos-version`).
export const getVersionFromFile = (filePath: string): string => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`The atmos-version-file '${filePath}' does not exist`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  const version = parseToolVersions(content) || parsePlainVersion(content);

  if (!version) {
    throw new Error(`No atmos version found in '${filePath}'`);
  }

  return version;
};

export const run = async () => {
  try {
    let versionSpec = core.getInput("atmos-version");
    const versionFile = core.getInput("atmos-version-file");

    if (versionFile) {
      if (versionSpec && versionSpec !== "latest") {
        core.warning(
          "Both 'atmos-version' and 'atmos-version-file' inputs are specified, only 'atmos-version' will be used."
        );
      } else {
        versionSpec = getVersionFromFile(versionFile);
        core.info(`Resolved atmos version '${versionSpec}' from '${versionFile}'`);
      }
    }

    core.info(`Setup atmos version spec ${versionSpec}`);

    const arch = core.getInput("architecture") || os.arch();
    const installWrapper = core.getInput("install-wrapper") === "true";
    const checksumValidation = installer.parseChecksumValidationMode(core.getInput("checksum-validation"));

    const token = core.getInput("token");
    const auth = !token ? undefined : `token ${token}`;

    const { toolPath, info } = await installer.getAtmos(versionSpec, auth, arch, installWrapper, checksumValidation);

    core.info(`Successfully set up Atmos version ${versionSpec} in ${toolPath}`);

    core.setOutput("atmos-version", info?.resolvedVersion);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    core.setFailed(error instanceof Error ? error.message : `${error}`);
  }
};
