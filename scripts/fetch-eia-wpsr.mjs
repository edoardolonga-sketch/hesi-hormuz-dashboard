import { writeFile } from "node:fs/promises";

const OUTPUT_FILE = new URL(
  "../data/eia-wpsr-latest.json",
  import.meta.url
);

const SOURCE_ID = "eia_wpsr";
const SERIES_ID = "WCESTUS1";

const EIA_URL =
  "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?f=W&n=PET&s=WCESTUS1";

const MONTHS = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12"
};

function cleanCell(text) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, "")
    .trim();
}

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
    /Release Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
  );

  const releaseDate = releaseMatch
    ? parseUsDate(releaseMatch[1])
    : null;

  if (!releaseDate) {
    throw new Error(
      "EIA release date could not be parsed safely."
    );
  }

  const cells = [
    ...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)
  ].map((match) => cleanCell(match[1]));

  let currentYear = null;
  let currentMonth = null;
  const observations = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];

    const monthHeader = cell.match(
      /^(\d{4})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/
    );

    if (monthHeader) {
      currentYear = monthHeader[1];
      currentMonth = MONTHS[monthHeader[2]];
      continue;
    }

    const dayMatch = cell.match(/^(\d{2})\/(\d{2})$/);

    if (!dayMatch || !currentYear || !currentMonth) {
      continue;
    }

    const [, month, day] = dayMatch;

    if (month !== currentMonth) {
      continue;
    }

    const valueCell = cells[i + 1] ?? "";

    if (!/^\d{1,3}(?:,\d{3})*$/.test(valueCell)) {
      continue;
    }

    const value = Number(valueCell.replace(/,/g, ""));

    if (!Number.isFinite(value)) {
      continue;
    }

    observations.push({
      observationDate: `${currentYear}-${month}-${day}`,
      value
    });
  }

  if (observations.length === 0) {
    throw new Error(
      "No EIA weekly observations could be parsed safely."
    );
  }

  const latest = observations[observations.length - 1];

  const output = {
    schemaVersion: "1.0",
    sourceId: SOURCE_ID,
    seriesId: SERIES_ID,
    executionTimestamp,
    observationDate: latest.observationDate,
    value: latest.value,
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
  console.log(`Parsed observations: ${observations.length}`);
  console.log(`Observation date: ${latest.observationDate}`);
  console.log(`Value: ${latest.value} thousand barrels`);
  console.log(`Release date: ${releaseDate}`);
  console.log(`Execution timestamp: ${executionTimestamp}`);
  console.log("Observation promoted: NO");
  console.log("AvailableAt protection: ENABLED");
}

main().catch((error) => {
  console.error("EIA WPSR fetch failed:");
  console.error(error);
  process.exit(1);
});
