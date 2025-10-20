import fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadCredentials", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.E2E_USER_EMAIL;
    delete process.env.E2E_USER_PASSWORD;
  });

  it("retourne les identifiants persistés lorsque le cache est valide", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const readSpy = vi
      .spyOn(fs, "readFileSync")
      .mockReturnValue(
        JSON.stringify({ email: "cached@example.com", password: "Secret123!" })
      );
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

    const module = await import("../../utils/load-credentials");
    const onRegenerated = vi.fn();
    const credentials = module.loadCredentials({ onRegenerated });

    expect(credentials).toEqual({
      email: "cached@example.com",
      password: "Secret123!",
    });
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(onRegenerated).not.toHaveBeenCalled();

    writeSpy.mockRestore();
    mkdirSpy.mockRestore();
    readSpy.mockRestore();
    existsSpy.mockRestore();
  });

  it("génère de nouveaux identifiants lorsque le cache est vide ou corrompu", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const readSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("   \n");
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

    process.env.E2E_USER_EMAIL = "fallback@example.com";
    process.env.E2E_USER_PASSWORD = "SafePass123!";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const module = await import("../../utils/load-credentials");
    const onRegenerated = vi.fn();
    const credentials = module.loadCredentials({ onRegenerated });

    expect(credentials).toEqual({
      email: "fallback@example.com",
      password: "SafePass123!",
    });
    expect(mkdirSpy).toHaveBeenCalledWith(module.AUTH_DIR, { recursive: true });
    expect(writeSpy).toHaveBeenCalledWith(
      module.CREDENTIALS_PATH,
      JSON.stringify(credentials, null, 2)
    );
    expect(warnSpy).toHaveBeenCalled();
    expect(onRegenerated).toHaveBeenCalledWith({
      credentials,
      reason: "empty",
    });

    warnSpy.mockRestore();
    writeSpy.mockRestore();
    mkdirSpy.mockRestore();
    readSpy.mockRestore();
    existsSpy.mockRestore();
  });

  it("remplace le cache lorsque des champs requis manquent", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const readSpy = vi
      .spyOn(fs, "readFileSync")
      .mockReturnValue(JSON.stringify({ email: "only@example.com" }));
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    process.env.E2E_USER_EMAIL = "fallback-missing@example.com";
    process.env.E2E_USER_PASSWORD = "Missing123!";

    const module = await import("../../utils/load-credentials");
    const onRegenerated = vi.fn();
    const credentials = module.loadCredentials({ onRegenerated });

    expect(credentials).toEqual({
      email: "fallback-missing@example.com",
      password: "Missing123!",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Playwright credential cache missing required fields; generating new credentials",
      expect.objectContaining({ cachePath: module.CREDENTIALS_PATH })
    );
    expect(writeSpy).toHaveBeenCalledWith(
      module.CREDENTIALS_PATH,
      JSON.stringify(credentials, null, 2)
    );
    expect(onRegenerated).toHaveBeenCalledWith({
      credentials,
      reason: "invalid_shape",
    });

    warnSpy.mockRestore();
    writeSpy.mockRestore();
    mkdirSpy.mockRestore();
    readSpy.mockRestore();
    existsSpy.mockRestore();
  });

  it("génère un nouveau cache lorsque le JSON persisté est illisible", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const readSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("{not-json");
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    process.env.E2E_USER_EMAIL = "corrupted@example.com";
    process.env.E2E_USER_PASSWORD = "Corrupted123!";

    const module = await import("../../utils/load-credentials");
    const onRegenerated = vi.fn();
    const credentials = module.loadCredentials({ onRegenerated });

    expect(credentials).toEqual({
      email: "corrupted@example.com",
      password: "Corrupted123!",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to parse persisted Playwright credentials; generating a new pair",
      expect.objectContaining({ cachePath: module.CREDENTIALS_PATH, error: expect.any(SyntaxError) })
    );
    expect(writeSpy).toHaveBeenCalledWith(
      module.CREDENTIALS_PATH,
      JSON.stringify(credentials, null, 2)
    );
    expect(onRegenerated).toHaveBeenCalledWith({
      credentials,
      reason: "invalid_json",
    });

    warnSpy.mockRestore();
    writeSpy.mockRestore();
    mkdirSpy.mockRestore();
    readSpy.mockRestore();
    existsSpy.mockRestore();
  });

  it("crée un cache lorsqu'aucun fichier n'existe", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);

    process.env.E2E_USER_EMAIL = "fresh@example.com";
    process.env.E2E_USER_PASSWORD = "Fresh123!";

    const module = await import("../../utils/load-credentials");
    const onRegenerated = vi.fn();
    const credentials = module.loadCredentials({ onRegenerated });

    expect(credentials).toEqual({
      email: "fresh@example.com",
      password: "Fresh123!",
    });
    expect(onRegenerated).toHaveBeenCalledWith({
      credentials,
      reason: "missing",
    });
    expect(mkdirSpy).toHaveBeenCalledWith(module.AUTH_DIR, { recursive: true });
    expect(writeSpy).toHaveBeenCalledWith(
      module.CREDENTIALS_PATH,
      JSON.stringify(credentials, null, 2)
    );

    writeSpy.mockRestore();
    mkdirSpy.mockRestore();
    existsSpy.mockRestore();
  });
});
