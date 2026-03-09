const EXAMPLES = {
  "unsafe-split": `#!/usr/bin/env bash
set -eu

files=$(find src -name '*.sh')
for file in $files; do
  shellcheck $file
done
`,
  "unused-export": `TERMUX_PKG_HOMEPAGE=https://github.com/pystardust/ytfzf
TERMUX_PKG_DESCRIPTION="A POSIX helper for YouTube"
TERMUX_PKG_LICENSE="GPL-3.0"
`,
  "strict-mode": `#!/usr/bin/env bash
set -e

build() {
  cd /tmp/project
  make all
}

! build
`,
};

const severityOrder = ["error", "warning", "info", "style"];
const MIN_EDITOR_HEIGHT = 280;
const MAX_EDITOR_HEIGHT = 760;

const state = {
  editor: null,
  model: null,
  worker: null,
  requestId: 0,
  inflight: new Map(),
  diagnostics: [],
  lintTimer: null,
  themePreference: "system",
};

const nodes = {
  status: document.getElementById("status-pill"),
  lintButton: document.getElementById("lint-button"),
  shareButton: document.getElementById("share-button"),
  shellSelect: document.getElementById("shell-select"),
  severitySelect: document.getElementById("severity-select"),
  exampleSelect: document.getElementById("example-select"),
  themeSelect: document.getElementById("theme-select"),
  list: document.getElementById("diagnostic-list"),
  summary: document.getElementById("summary-line"),
  badges: document.getElementById("summary-badges"),
};

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

function requireMonaco() {
  return new Promise((resolve) => {
    window.require.config({
      paths: {
        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs",
      },
    });
    window.require(["vs/editor/editor.main"], resolve);
  });
}

function initWorker() {
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    const pending = state.inflight.get(data.id);
    if (!pending) {
      return;
    }
    state.inflight.delete(data.id);
    if (data.ok) {
      pending.resolve(data.payload);
    } else {
      pending.reject(new Error(data.error));
    }
  };
  state.worker = worker;
}

function callWorker(kind, payload) {
  const id = ++state.requestId;
  return new Promise((resolve, reject) => {
    state.inflight.set(id, { resolve, reject });
    state.worker.postMessage({ id, kind, payload });
  });
}

function setStatus(text, kind = "ok") {
  nodes.status.textContent = text;
  nodes.status.classList.toggle("error", kind === "error");
}

function decodeHash() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const encoded = hash.get("code");
  if (!encoded) {
    return null;
  }
  try {
    return decodeURIComponent(escape(atob(encoded)));
  } catch {
    return null;
  }
}

function encodeHash(content) {
  return btoa(unescape(encodeURIComponent(content)));
}

function buildOptions() {
  return {
    shell: nodes.shellSelect.value || null,
    severity: nodes.severitySelect.value,
  };
}

function resolveTheme(preference) {
  return preference === "system"
    ? (systemTheme.matches ? "dark" : "light")
    : preference;
}

function monacoThemeName(theme) {
  return theme === "dark" ? "vs-dark" : "vs";
}

function applyTheme(monaco) {
  const resolvedTheme = resolveTheme(state.themePreference);
  document.documentElement.dataset.theme = resolvedTheme;
  if (monaco) {
    monaco.editor.setTheme(monacoThemeName(resolvedTheme));
  }
}

function loadThemePreference() {
  const storedTheme = window.localStorage.getItem("anvish-theme");
  state.themePreference = storedTheme || "system";
  nodes.themeSelect.value = state.themePreference;
}

function setThemePreference(monaco, preference) {
  state.themePreference = preference;
  window.localStorage.setItem("anvish-theme", preference);
  applyTheme(monaco);
}

function summarize(diagnostics) {
  if (!diagnostics.length) {
    nodes.summary.textContent = "No diagnostics. Browser run matches a clean Anvish check.";
    nodes.badges.innerHTML = '<span class="badge clean">clean</span>';
    return;
  }

  nodes.summary.textContent = `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"} in the current buffer.`;
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    counts.set(diagnostic.severity, (counts.get(diagnostic.severity) || 0) + 1);
  }
  nodes.badges.innerHTML = severityOrder
    .filter((severity) => counts.has(severity))
    .map((severity) => `<span class="badge ${severity}">${counts.get(severity)} ${severity}</span>`)
    .join("");
}

function renderDiagnostics(diagnostics) {
  state.diagnostics = diagnostics;
  summarize(diagnostics);

  if (!diagnostics.length) {
    nodes.list.innerHTML = '<li class="empty-state">No issues found for the current shell mode.</li>';
    return;
  }

  nodes.list.innerHTML = diagnostics
    .map((diagnostic, index) => `
      <li class="diagnostic-item" data-index="${index}">
        <div class="diagnostic-topline">
          <span class="diagnostic-code">${diagnostic.code}</span>
          <span>${diagnostic.severity}</span>
          <span>${diagnostic.line}:${diagnostic.column}</span>
        </div>
        <div class="diagnostic-message">${escapeHtml(diagnostic.message)}</div>
        <div class="diagnostic-source">${escapeHtml(diagnostic.source_line)}</div>
      </li>
    `)
    .join("");

  for (const item of nodes.list.querySelectorAll(".diagnostic-item")) {
    item.addEventListener("click", () => {
      const diagnostic = state.diagnostics[Number(item.dataset.index)];
      state.editor.revealLineInCenter(diagnostic.line);
      state.editor.setPosition({ lineNumber: diagnostic.line, column: diagnostic.column });
      state.editor.focus();
    });
  }
}

function applyMarkers(monaco, diagnostics) {
  const markers = diagnostics.map((diagnostic) => ({
    startLineNumber: diagnostic.line,
    startColumn: diagnostic.column,
    endLineNumber: diagnostic.end_line,
    endColumn: diagnostic.end_column,
    severity: toMarkerSeverity(monaco, diagnostic.severity),
    message: `${diagnostic.code}: ${diagnostic.message}`,
    code: diagnostic.code,
    source: "anvish",
  }));
  monaco.editor.setModelMarkers(state.model, "anvish", markers);
}

function editorMaxHeight() {
  return Math.min(MAX_EDITOR_HEIGHT, Math.floor(window.innerHeight * 0.72));
}

function layoutEditor() {
  if (!state.editor) {
    return;
  }
  const nextHeight = Math.max(MIN_EDITOR_HEIGHT, editorMaxHeight());
  const editorNode = state.editor.getDomNode();
  if (editorNode && editorNode.style.height !== `${nextHeight}px`) {
    editorNode.style.height = `${nextHeight}px`;
  }
  state.editor.layout();
}

function toMarkerSeverity(monaco, severity) {
  switch (severity) {
    case "error":
      return monaco.MarkerSeverity.Error;
    case "warning":
      return monaco.MarkerSeverity.Warning;
    case "info":
      return monaco.MarkerSeverity.Info;
    default:
      return monaco.MarkerSeverity.Hint;
  }
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function lint(monaco) {
  const content = state.model.getValue();
  setStatus("Linting…");
  try {
    const response = await callWorker("lint", {
      filename: "playground.sh",
      content,
      options: buildOptions(),
    });
    const diagnostics = Array.isArray(response?.diagnostics) ? response.diagnostics : [];
    renderDiagnostics(diagnostics);
    applyMarkers(monaco, diagnostics);
    setStatus(diagnostics.length ? `${diagnostics.length} diagnostics` : "Clean");
  } catch (error) {
    renderDiagnostics([]);
    applyMarkers(monaco, []);
    setStatus(error.message, "error");
  }
}

function scheduleLint(monaco) {
  clearTimeout(state.lintTimer);
  state.lintTimer = setTimeout(() => lint(monaco), 180);
}

function applyExample(name) {
  const content = EXAMPLES[name] || EXAMPLES["unsafe-split"];
  state.model.setValue(content);
  window.location.hash = `code=${encodeHash(content)}`;
}

async function bootstrap() {
  const monaco = await requireMonaco();
  loadThemePreference();
  applyTheme(monaco);
  initWorker();
  state.model = monaco.editor.createModel(
    decodeHash() || EXAMPLES["unsafe-split"],
    "shell",
  );
  state.editor = monaco.editor.create(document.getElementById("editor"), {
    model: state.model,
    theme: monacoThemeName(resolveTheme(state.themePreference)),
    minimap: { enabled: false },
    automaticLayout: true,
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 14,
    lineHeight: 22,
    padding: { top: 18, bottom: 18 },
    smoothScrolling: true,
    roundedSelection: true,
    overviewRulerLanes: 2,
    scrollBeyondLastLine: false,
  });
  layoutEditor();

  setStatus("Runtime ready");
  nodes.exampleSelect.value = "unsafe-split";

  state.model.onDidChangeContent(() => {
    window.location.hash = `code=${encodeHash(state.model.getValue())}`;
    scheduleLint(monaco);
  });
  nodes.shellSelect.addEventListener("change", () => lint(monaco));
  nodes.severitySelect.addEventListener("change", () => lint(monaco));
  nodes.exampleSelect.addEventListener("change", () => applyExample(nodes.exampleSelect.value));
  nodes.themeSelect.addEventListener("change", () => setThemePreference(monaco, nodes.themeSelect.value));
  nodes.lintButton.addEventListener("click", () => lint(monaco));
  nodes.shareButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(window.location.href);
    setStatus("Share link copied");
  });

  await lint(monaco);

  systemTheme.addEventListener("change", () => {
    if (state.themePreference === "system") {
      applyTheme(monaco);
    }
  });
  window.addEventListener("resize", () => layoutEditor());
}

bootstrap().catch((error) => {
  setStatus(error.message, "error");
});
