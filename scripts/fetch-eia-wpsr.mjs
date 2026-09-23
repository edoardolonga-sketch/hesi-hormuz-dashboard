import { writeFile } from "node:fs/promises";

const OUTPUT_FILE = new URL(
  "../data/eia-wpsr-latest.json",
  import.meta.url
);

const SOURCE_ID = "eia_wpsr";
const SERIES_ID = "WCESTUS1";

const EIA_URL =
  "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=WCESTUS1";

function parseUsDate(text) {
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (!match) return null;

  const [, month, day, year] = match;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

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

  if (!html.includes("Weekly U.S. Ending Stocks")) {
    throw new Error("Unexpected EIA response.");
  }

  const releaseMatch = html.match(
    /Release Date:\s*<\/[^>]+>\s*([^<]+)/i
  );

  const releaseDate = releaseMatch
    ? parseUsDate(releaseMatch[1])
    : null;

  const rowMatches = [
    ...html.matchAll(
      /(\d{2}\/\d{2}\/\d{2})[\s\S]{0,500}?([\d,]+)\s*<\/td>/gi
    )
  ];

  if (rowMatches.length === 0) {
    throw new Error(
      "No EIA weekly observations could be parsed safely."
    );
  }

  const latest = rowMatches[rowMatches.length - 1];

  const shortDate = latest[1];
  const valueText = latest[2].replace(/,/g, "");

  const [month, day, shortYear] = shortDate.split("/");
  const observationDate =
    `20${shortYear}-${month}-${day}`;

  const value = Number(valueText);

  if (!Number.isFinite(value)) {
    throw new Error("Parsed EIA value is not numeric.");
  }

  /*
   * IMPORTANT:
   * releaseDate is recorded as provenance, but we deliberately
   * do not invent an intraday release timestamp.
   *
   * Promotion into latest-observations.json remains disabled
   * until AvailableAt can be represented without ambiguity.
   */

  const output = {
    schemaVersion: "1.0",
    sourceId: SOURCE_ID,
    seriesId: SERIES_ID,
    executionTimestamp,
    observationDate,
    value,
    unit: "thousand_barrels",
    releaseDate,
    availableAt: null,
    availableAtRule: "ENABLED",
    sourceUrl: EIA_URL,
    fetchStatus: "SUCCESS",
    responseValidated: true,
    observationPromoted: false,
    note:
      "Observation parsed from official EIA source. Promotion remains disabled until an exact defensible AvailableAt timestamp is established."
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("EIA WPSR fetch + parse");
  console.log("----------------------");
  console.log(`Source: ${SOURCE_ID}`);
  console.log(`Series: ${SERIES_ID}`);
  console.log(`Observation date: ${observationDate}`);
  console.log(`Value: ${value} thousand barrels`);
  console.log(`Release date: ${releaseDate ?? "NOT PARSED"}`);
  console.log(`Execution timestamp: ${executionTimestamp}`);
  console.log("Observation promoted: NO");
  console.log("AvailableAt protection: ENABLED");
}

main().catch((error) => {
  console.error("EIA WPSR fetch failed:");
  console.error(error);
  process.exit(1);
});
