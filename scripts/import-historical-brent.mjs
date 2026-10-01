import { writeFile } from "node:fs/promises";

const OUTPUT_FILE = new URL(
  "../data/brent-historical-quarantine.json",
  import.meta.url
);

const SERIES_ID = "DCOILBRENTEU";

const FRED_CSV_URL =
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU";

function parseCsv(text) {
  const lines = text
    .trim()
    .split(/\r?\n/);

  if (lines.length < 2) {
    throw new Error(
      "Historical Brent CSV contains no observations."
    );
  }

  const header = lines[0]
    .split(",")
    .map((value) => value.trim());

  const dateIndex =
    header.indexOf("DATE") >= 0
      ? header.indexOf("DATE")
      : header.indexOf("observation_date");

  const valueIndex =
    header.indexOf(SERIES_ID);

  if (dateIndex < 0 || valueIndex < 0) {
    throw new Error(
      `Unexpected CSV header: ${lines[0]}`
    );
  }

  const observations = [];

  for (const line of lines.slice(1)) {
    const columns =
      line.split(",");

    const observationDate =
      columns[dateIndex]?.trim();

    const rawValue =
      columns[valueIndex]?.trim();

    if (
      !observationDate ||
      !rawValue ||
      rawValue === "."
    ) {
      continue;
    }

    const value =
      Number(rawValue);

    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      continue;
    }

    observations.push({
      sourceId: "brent_market",
      seriesId: SERIES_ID,
      observationDate,
      availableAt: null,
      value,
      unit: "usd_per_barrel",
      frequency: "daily",
      admissionStatus:
        "QUARANTINED_AVAILABLE_AT_UNVERIFIED"
    });
  }

  return observations;
}

async function main() {
  const fetchTimestamp =
    new Date().toISOString();

  const response =
    await fetch(FRED_CSV_URL);

  if (!response.ok) {
    throw new Error(
      `Historical Brent fetch failed: HTTP ${response.status}`
    );
  }

  const csv =
    await response.text();

  const observations =
    parseCsv(csv);

  if (observations.length === 0) {
    throw new Error(
      "No usable historical Brent observations found."
    );
  }

  const output = {
    schemaVersion: "1.0",

    status:
      "QUARANTINED_AVAILABLE_AT_UNVERIFIED",

    sourceId:
      "brent_market",

    seriesId:
      SERIES_ID,

    fetchTimestamp,

    leakageSafeAdmission:
      false,

    availableAtPolicy:
      "Historical values are retained for research, but AvailableAt is intentionally null. observationDate must never be substituted for historical AvailableAt without defensible publication or vintage metadata.",

    summary: {
      observationCount:
        observations.length,

      firstObservationDate:
        observations[0]
          .observationDate,

      lastObservationDate:
        observations[
          observations.length - 1
        ].observationDate,

      admittedToLeakageSafeDataset:
        0
    },

    observations,

    promotion: {
      historicalStoreUpdated:
        false,

      calibrationDatasetUpdated:
        false,

      officialHesiUpdated:
        false
    },

    notes: [
      "This file is a quarantine research layer.",
      "Historical Brent values are not automatically leakage-safe.",
      "availableAt is intentionally null for every quarantined observation.",
      "No quarantined observation may enter historical-observations.json until its historical availability can be defended.",
      "observationDate is not treated as AvailableAt.",
      "This file must not be used directly for HESI calibration, walk-forward validation or official forecasting."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(
      output,
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    "Historical Brent quarantine import"
  );

  console.log(
    "----------------------------------"
  );

  console.log(
    `Observations downloaded: ${observations.length}`
  );

  console.log(
    `First observation: ${output.summary.firstObservationDate}`
  );

  console.log(
    `Last observation: ${output.summary.lastObservationDate}`
  );

  console.log(
    "Historical AvailableAt verified: NO"
  );

  console.log(
    "Leakage-safe admission: NO"
  );

  console.log(
    "Calibration dataset modified: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "Historical Brent quarantine import failed:"
  );

  console.error(error);

  process.exit(1);
});
