// Patcher -- Injects/removes Uprooted's preload script and CSS
// from Root's profile HTML files (WebRtcBundle + RootApps).

import fs from "node:fs";
import path from "node:path";
import { loadSettings } from "./settings.js";

const PROFILE_DIR = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Root Communications",
  "Root",
  "profile",
  "default",
);

const BACKUP_SUFFIX = ".uprooted.bak";

const INJECTION_MARKER = "<!-- uprooted -->";

/** Glob patterns relative to the profile directory. */
function findTargetHtmlFiles(): string[] {
  const targets: string[] = [];

  // WebRtcBundle/index.html
  const webrtcIndex = path.join(PROFILE_DIR, "WebRtcBundle", "index.html");
  if (fs.existsSync(webrtcIndex)) targets.push(webrtcIndex);

  // RootApps/*/index.html
  const rootAppsDir = path.join(PROFILE_DIR, "RootApps");
  if (fs.existsSync(rootAppsDir)) {
    for (const entry of fs.readdirSync(rootAppsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const appIndex = path.join(rootAppsDir, entry.name, "index.html");
        if (fs.existsSync(appIndex)) targets.push(appIndex);
      }
    }
  }

  return targets;
}

export function install(distDir: string): void {
  const preloadPath = path.join(distDir, "uprooted-preload.js").replace(/\\/g, "/");
  const cssPath = path.join(distDir, "uprooted.css").replace(/\\/g, "/");
  const settings = loadSettings();

  const settingsTag = `<script>${INJECTION_MARKER}window.__UPROOTED_SETTINGS__=${JSON.stringify(settings)};</script>`;
  const scriptTag = `<script src="file:///${preloadPath}">${INJECTION_MARKER}</script>`;
  const linkTag = `<link rel="stylesheet" href="file:///${cssPath}">${INJECTION_MARKER}`;

  const injection = `${settingsTag}\n    ${scriptTag}\n    ${linkTag}`;

  const targets = findTargetHtmlFiles();

  if (targets.length === 0) {
    console.error("No target HTML files found in:", PROFILE_DIR);
    process.exit(1);
  }

  for (const file of targets) {
    const content = fs.readFileSync(file, "utf-8");

    if (content.includes(INJECTION_MARKER)) {
      console.log(`Already injected: ${file}`);
      continue;
    }

    // Backup original
    const backupPath = file + BACKUP_SUFFIX;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(file, backupPath);
      console.log(`Backed up: ${backupPath}`);
    }

    // Inject before </head>
    const patched = content.replace("</head>", `    ${injection}\n  </head>`);
    fs.writeFileSync(file, patched, "utf-8");
    console.log(`Injected: ${file}`);
  }

  console.log(`\nUprooted installed. Restart Root to apply.`);
}

export function uninstall(): void {
  const targets = findTargetHtmlFiles();

  for (const file of targets) {
    const backupPath = file + BACKUP_SUFFIX;

    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, file);
      fs.unlinkSync(backupPath);
      console.log(`Restored: ${file}`);
    } else {
      // Fallback: strip injection markers
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(INJECTION_MARKER)) {
        const cleaned = content
          .split("\n")
          .filter((line) => !line.includes(INJECTION_MARKER))
          .join("\n");
        fs.writeFileSync(file, cleaned, "utf-8");
        console.log(`Stripped injection: ${file}`);
      }
    }
  }

  console.log(`\nUprooted uninstalled. Restart Root to apply.`);
}
