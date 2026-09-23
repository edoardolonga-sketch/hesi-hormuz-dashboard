import { readFile } from "node:fs/promises";

const DATA_FILE = new URL("../data/dashboard-data.json", import.meta.url);
const SOURCES_FILE = new URL("../data/sources.json", import.meta.url);

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

async function main() {
  const data = await readJson(DATA_FILE, "dashboard-data.json");
  const sourceRegistry = await readJson(SOURCES_FILE, "sources.json");

  // Validate HESI dashboard data
  if (!data.hesi) {
    throw new Error("Missing HESI block in dashboard-data.json");
  }

  if (!data.hesi.asOf) {
    throw new Error("Missing HESI asOf date");
  }

  const requiredHesiFields = ["effective", "physical", "market"];

  for (const field of requiredHesiFields) {
    if (typeof data.hesi[field] !== "number") {
      throw new Error(`Invalid or missing HESI field: ${field}`);
    }

    if (data.hesi[field] < 0 || data.hesi[field] > 100) {
      throw new Error(`HESI field outside 0-100 range: ${field}`);
    }
  }

  // Validate source registry
  if (!sourceRegistry.availableAtPolicy) {
    throw new Error("Missing AvailableAt policy in sources.json");
  }

  if (
    !Array.isArray(sourceRegistry.sources) ||
    sourceRegistry.sources.length === 0
  ) {
    throw new Error("No sources defined in sources.json");
  }

  const ids = new Set();

  for (const source of sourceRegistry.sources) {
    if (!source.id || !source.name || !source.domain || !source.status) {
      throw new Error("Incomplete source definition in sources.json");
    }

    if (ids.has(source.id)) {
      throw new Error(`Duplicate source id: ${source.id}`);
    }

    ids.add(source.id);

    if (source.availableAtRequired !== true) {
      throw new Error(
        `AvailableAt protection is not enabled for source: ${source.id}`
      );
    }
  }

  console.log("HESI pipeline validation");
  console.log("------------------------");
  console.log(`Available checkpoint: ${data.hesi.asOf}`);
  console.log(`HESI Effective: ${data.hesi.effective}`);
  console.log(`Physical Stress: ${data.hesi.physical}`);
  console.log(`Market Stress: ${data.hesi.market}`);
  console.log(`Registered sources: ${sourceRegistry.sources.length}`);
  console.log("AvailableAt protection: ENABLED");
  console.log("");
  console.log("Validation passed.");
  console.log("No dashboard data were modified.");
}

main().catch((error) => {
  console.error("HESI pipeline failed:");
  console.error(error);
  process.exit(1);
});
