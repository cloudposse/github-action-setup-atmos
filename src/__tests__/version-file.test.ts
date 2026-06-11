import fs from "fs";
import os from "os";
import path from "path";

import { getVersionFromFile, parseToolVersions } from "../main";

describe("parseToolVersions", () => {
  it("returns the atmos version from a .tool-versions file", () => {
    expect(parseToolVersions("terraform 1.7.0\natmos 1.15.0\n")).toBe("1.15.0");
  });

  it("ignores comments and blank lines", () => {
    expect(parseToolVersions("# pinned tools\n\n  atmos   1.13.0  \n")).toBe("1.13.0");
  });

  it("returns an empty string when atmos is not declared", () => {
    expect(parseToolVersions("terraform 1.7.0\nhelm 3.14.0\n")).toBe("");
  });

  it("does not match a tool whose name only contains 'atmos'", () => {
    expect(parseToolVersions("atmos-pro 2.0.0\n")).toBe("");
  });
});

describe("getVersionFromFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atmos-version-file-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  const write = (name: string, content: string): string => {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content);

    return filePath;
  };

  it("reads the atmos version from a .tool-versions file", () => {
    const filePath = write(".tool-versions", "atmos 1.15.0\n");
    expect(getVersionFromFile(filePath)).toBe("1.15.0");
  });

  it("reads a plain version file as the version", () => {
    const filePath = write(".atmos-version", "1.14.0\n");
    expect(getVersionFromFile(filePath)).toBe("1.14.0");
  });

  it("throws when the file does not exist", () => {
    expect(() => getVersionFromFile(path.join(dir, "missing"))).toThrow("does not exist");
  });

  it("throws when the file is empty", () => {
    const filePath = write(".tool-versions", "# only comments\n");
    expect(() => getVersionFromFile(filePath)).toThrow("No atmos version found");
  });
});
