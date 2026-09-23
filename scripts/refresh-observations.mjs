import { readFile, writeFile } from "node:fs/promises";

const SOURCES_FILE = new URL("../data/sources.json", import.meta.url);
const OBSERVATIONS_FILE = new URL(
  "../data/latest-observations.json",
  import.meta.url
);

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

async function main() {
  const executionTimestamp = new Date().toISOString();

  const sourceRegistry = await readJson(SOURCES_FILE, "sources.json");
  const current = await readJson(
    OBSERVATIONS_FILE,
    "latest-observations.json"
  );

  if (!Array.isArray(sourceRegistry.sources)) {
    throw new Error("No source registry found.");
  }

  if (!Array.isArray(current.observations)) {
    throw new Error("Invalid observations array.");
  }

  /*
   * IMPORTANT
   * ---------
   * This script deliberately does NOT invent or backfill observations.
   *
   * Future source adapters will retrieve observations from the registered
   * public sources and must attach:
   *
   *   sourceId
   *   observationDate
   *   availableAt
   *   value
   *
   * An observation may be accepted only when:
   *
   *   availableAt <= executionTimestamp
   *
   * Until those source adapters are connected and validated, the last
   * available observations are retained unchanged.
   */

  const output = {
    ...current,
    updatedAt: executionTimestamp,
    executionTimestamp,
    observations: current.observations,
    notes: current.notes
  };

  await writeFile(
    OBSERVATIONS_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("HESI observation refresh");
  console.log("------------------------");
  console.log(`Execution timestamp: ${executionTimestamp}`);
  console.log(`Registered sources: ${sourceRegistry.sources.length}`);
  console.log(`Retained observations: ${current.observations.length}`);
  console.log("AvailableAt rule: ENABLED");
  console.log("No observations were invented or backfilled.");
}

main().catch((error) => {
  console.error("Observation refresh failed:");
  console.error(error);
  process.exit(1);
});
