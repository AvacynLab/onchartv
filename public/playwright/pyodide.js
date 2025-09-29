(function bootstrapPlaywrightPyodideStub(globalObject) {
  if (typeof globalObject !== "object" || globalObject === null) {
    return;
  }

  if (typeof globalObject.loadPyodide === "function") {
    return;
  }

  /**
   * Provide a lightweight stand-in for Pyodide so Playwright end-to-end tests
   * can interact with the code-runner UI without reaching the public CDN.
   */
  globalObject.loadPyodide = async function loadPyodideStub() {
    let batchedStdout = undefined;

    return {
      /**
       * Store the stdout handler supplied by the chat UI. The stub forwards any
       * simulated output back through the same callback to mimic Pyodide's API.
       */
      setStdout(stdoutConfig) {
        batchedStdout =
          stdoutConfig && typeof stdoutConfig.batched === "function"
            ? stdoutConfig.batched
            : undefined;
      },
      /**
       * Skip package installation during hermetic runs while still emitting a
       * helpful message so the UI reflects that work would normally happen.
       */
      async loadPackagesFromImports(_code, options = {}) {
        if (typeof options.messageCallback === "function") {
          options.messageCallback("Pyodide package install skipped (Playwright stub).");
        }
      },
      /**
       * Pretend to execute Python code. When the chat UI provided an stdout
       * handler we forward a short notice so tests observe a completed run.
       */
      async runPythonAsync(code) {
        if (batchedStdout) {
          const preview = typeof code === "string" ? code.slice(0, 60) : "";
          batchedStdout(`Pyodide stub executed${preview ? `: ${preview}` : "."}`);
        }
        return null;
      },
    };
  };
})(globalThis);
