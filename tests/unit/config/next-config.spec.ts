import nextConfig from "../../../next.config";

/**
 * The finance news artefact displays remote publication logos. This regression
 * guard ensures the Next.js image optimiser continues to allowlist the
 * Clearbit and Reuters hosts so those thumbnails never fail at runtime.
 */
describe("next.config images", () => {
  it("allowlists the finance news logo domains", () => {
    const remoteHosts = new Set(
      nextConfig.images?.remotePatterns?.map((pattern) => pattern.hostname)
    );

    expect(remoteHosts.has("logo.clearbit.com")).toBe(true);
    expect(remoteHosts.has("static.reuters.com")).toBe(true);
  });
});
