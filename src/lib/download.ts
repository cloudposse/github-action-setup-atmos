import fs from "fs";
import axios from "axios";
import path from "path";

export const downloadAtmos = async (
  version: string,
  os: string,
  arch: string,
  outputPath = "./atmos"
) => {
  const url = getDownloadUrl(version, os, arch);

  const response = await axios.get(url, {
    url,
    method: "GET",
    responseType: "arraybuffer",
  });

  await fs.writeFileSync(outputPath, response.data);

  return path.resolve(outputPath);
};

export const getDownloadUrl = (version: string, os: string, arch: string) =>
  `https://github.com/cloudposse/atmos/releases/download/v${version}/atmos_${version}_${os}_${arch}`;

