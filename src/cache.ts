import * as cache from "@actions/cache";
import * as core from "@actions/core";

export const isGhes = (): boolean => {
  const ghUrl = new URL(
    process.env["GITHUB_SERVER_URL"] || "https://github.com",
  );
  return ghUrl.hostname.toUpperCase() !== "GITHUB.COM";
};

export const isCacheFeatureAvailable = (): boolean => {
  if (cache.isFeatureAvailable()) {
    return true;
  }

  if (isGhes()) {
    core.warning(
      "Cache action is only supported on GHES version >= 3.5. If you are on version >=3.5 Please check with GHES admin if Actions cache service is enabled or not.",
    );
    return false;
  }

  core.warning(
    "The runner was not able to contact the cache service. Caching will be skipped",
  );
  return false;
};

