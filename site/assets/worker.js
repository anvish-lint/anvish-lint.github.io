import { File, OpenFile, PreopenDirectory, WASI } from "https://esm.sh/@bjorn3/browser_wasi_shim@0.4.2";

let wasmBytes;

async function ensureWasmBytes() {
  if (!wasmBytes) {
    const response = await fetch(new URL("../pkg/anvish-site-runner.wasm", import.meta.url));
    if (!response.ok) {
      throw new Error(`Failed to fetch runner: ${response.status}`);
    }
    wasmBytes = await response.arrayBuffer();
  }
  return wasmBytes;
}

function decodeBytes(file) {
  return new TextDecoder().decode(file.data);
}

async function runLint(content, options) {
  const stdin = new File(new TextEncoder().encode(content));
  const stdout = new File([]);
  const stderr = new File([]);
  const args = ["anvish-site-runner"];
  if (options.shell) {
    args.push("--shell", options.shell);
  }
  args.push("--severity", options.severity || "style");

  const wasi = new WASI(
    args,
    [],
    [
      new OpenFile(stdin),
      new OpenFile(stdout),
      new OpenFile(stderr),
      new PreopenDirectory(".", []),
    ],
  );
  const module = await WebAssembly.compile(await ensureWasmBytes());
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  wasi.start(instance);

  const raw = decodeBytes(stdout).trim();
  if (!raw) {
    const errors = decodeBytes(stderr).trim();
    if (errors) {
      throw new Error(errors);
    }
    return [];
  }
  return JSON.parse(raw);
}

self.onmessage = async ({ data }) => {
  const { id, kind, payload } = data;
  try {
    if (kind !== "lint") {
      throw new Error(`Unknown worker message kind: ${kind}`);
    }
    const diagnostics = await runLint(payload.content, payload.options);
    self.postMessage({ id, ok: true, payload: { diagnostics } });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
