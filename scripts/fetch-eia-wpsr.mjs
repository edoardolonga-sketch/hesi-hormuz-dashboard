import { writeFile } from "node:fs/promises";

const OUTPUT_FILE = new URL(
  "../data/eia-wpsr-latest.json",
  import.meta.url
);

const SOURCE_ID = "eia_wpsr";
const SERIES_ID = "WCESTUS1";

const EIA_URL =
  "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=WCESTUS1";

async function main() {
  const executionTimestamp = new Date().toISOString();

  const response = await fetch(EIA_URL, {
    headers: {
      "User-Agent": "hesi-hormuz-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `EIA request failed: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();

  /*
   * This first adapter deliberately stores the official EIA response
   * metadata without guessing or backfilling an observation.
   *
   * Parsing and promotion into latest-observations.json will be added
   * only after the returned EIA document has been validated.
   */

  if (!html.includes("Weekly U.S. Ending Stocks")) {
    throw new Error(
      "Unexpected EIA response. Expected weekly crude-oil stocks page."
    );
  }

  const output = {
    schemaVersion: "1.0",
    sourceId: SOURCE_ID,
    seriesId: SERIES_ID,
    executionTimestamp,
    availableAtRule: "ENABLED",
    sourceUrl: EIA_URL,
    fetchStatus: "SUCCESS",
    responseValidated: true,
    observationPromoted: false,
    note:
      "Official EIA source fetched successfully. No observation is promoted until parsing and AvailableAt validation are complete."
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("EIA WPSR fetch");
  console.log("--------------");
  console.log(`Source: ${SOURCE_ID}`);
  console.log(`Series: ${SERIES_ID}`);
  console.log(`Execution timestamp: ${executionTimestamp}`);
  console.log("Official EIA response: VALIDATED");
  console.log("Observation promoted: NO");
  console.log("AvailableAt protection: ENABLED");
}

main().catch((error) => {
  console.error("EIA WPSR fetch failed:");
  console.error(error);
  process.exit(1);
});
