import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = path.resolve(__dirname, "../../..");

export interface LocalConfig {
  showcaseDir: string;
  composeFile: string;
  localPorts: Record<string, number>;
  pocketbase: {
    url: string;
    email: string;
    password: string;
  };
  aimockUrl: string;
  dashboardUrl: string;
  dashboardPort: number;
}

export function loadConfig(): LocalConfig {
  const portsFile = path.join(SHOWCASE_DIR, "shared/local-ports.json");
  const localPorts = JSON.parse(fs.readFileSync(portsFile, "utf-8")) as Record<
    string,
    number
  >;

  return {
    showcaseDir: SHOWCASE_DIR,
    composeFile: path.join(SHOWCASE_DIR, "docker-compose.local.yml"),
    localPorts,
    pocketbase: {
      url: "http://localhost:8090",
      email: "admin@localhost",
      password: "showcase-local-dev",
    },
    aimockUrl: "http://localhost:4010",
    dashboardUrl: "http://localhost:3200",
    dashboardPort: 3200,
  };
}

export function getPackageUrl(slug: string, config: LocalConfig): string {
  const port = config.localPorts[slug];
  if (!port) {
    throw new Error(
      `No local port mapping for slug "${slug}". Check shared/local-ports.json.`,
    );
  }
  return `http://localhost:${port}`;
}
