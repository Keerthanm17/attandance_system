const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const distDir = path.join(rootDir, "dist");

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function copyFile(fileName) {
  fs.copyFileSync(path.join(rootDir, fileName), path.join(distDir, fileName));
}

loadDotEnv();

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

let indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
if (indexHtml.includes("__FIREBASE_API_KEY__")) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY;
  if (!firebaseApiKey) {
    throw new Error("Missing FIREBASE_API_KEY. Add it to .env locally or Netlify environment variables.");
  }
  indexHtml = indexHtml.replace("__FIREBASE_API_KEY__", firebaseApiKey);
}

fs.writeFileSync(path.join(distDir, "index.html"), indexHtml);
copyFile("script.js");
copyFile("style.css");
