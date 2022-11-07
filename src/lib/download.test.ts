import { downloadAtmos } from "./download";
import axios from "axios";
import fs from "fs";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("download", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockResolvedValue({
      data: "Here is the file content",
      status: 200,
      statusText: "Ok",
      headers: {},
      config: {},
    });
  });

  it("should create valid url", async () => {
    const atmosVersion = "0.17.0";
    const atmosOS = "linux";
    const atmosArch = "amd64";

    await downloadAtmos(atmosVersion, atmosOS, atmosArch);

    expect(mockedAxios.get.mock.calls[0][0]).toBe(
      `https://github.com/cloudposse/atmos/releases/download/v${atmosVersion}/atmos_${atmosVersion}_${atmosOS}_${atmosArch}`
    );
  });

  it("should write contents to disk with default path", async () => {
    const atmosVersion = "0.17.0";
    const atmosOS = "linux";
    const atmosArch = "amd64";

    await downloadAtmos(atmosVersion, atmosOS, atmosArch);

    expect(mockedFs.writeFileSync.mock.calls[0][0]).toBe("./atmos");
  });

  it("should write contents to disk with custom path", async () => {
    const atmosVersion = "0.17.0";
    const atmosOS = "linux";
    const atmosArch = "amd64";
    const path = "/tmp/atmos";

    await downloadAtmos(atmosVersion, atmosOS, atmosArch, path);

    expect(mockedFs.writeFileSync.mock.calls[0][0]).toBe(path);
  });
});

