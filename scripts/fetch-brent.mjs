import { writeFile } from "node:fs/promises";

const OUTPUT_FILE = new URL(
  "../data/brent-latest.json",
  import.meta.url
);

const SOURCE_ID = "brent_market";
const SERIES_ID = "DCOILBRENTEU";

const DATA_URL =
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU";

async function main() {
  const executionTimestamp = new Date().toISOString();

  const response = await fetch(DATA_URL, {
    headers: {
      "User-Agent": "hesi-hormuz-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Brent request failed: ${response.status} ${response.statusText}`
    );
  }

  const csv = await response.text();

  const lines = csv
    .trim()
    .split(/\r?\n/)
    .slice(1);

  const observations = [];

  for (const line of lines) {
    const [date, rawValue] = line.split(",");

    if (!date || !rawValue) {
      continue;
    }

    const value = Number(rawValue);

    if (!Number.isFinite(value)) {
      continue;
    }

    observations.push({
      observationDate: date.trim(),
      value
    });
  }

  if (observations.length === 0) {
    throw new Error(
      "No valid Brent observations could be parsed."
    );
  }

  const latest =
    observations[observations.length - 1];

  /*
   * ANTI-LEAKAGE RULE
   *
   * availableAt is the timestamp at which our pipeline
   * actually observed the public datum.
   *
   * We do not invent an earlier publication timestamp.
   */
  const output = {
    schemaVersion: "1.0",

    sourceId: SOURCE_ID,
    seriesId: SERIES_ID,

    executionTimestamp,

    observationDate:
      latest.observationDate,

    availableAt:
      executionTimestamp,

    value:
      latest.value,

    unit:
      "usd_per_barrel",

    frequency:
      "daily",

    source:
      "U.S. Energy Information Administration via FRED",

    sourceUrl:
      DATA_URL,

    fetchStatus:
      "SUCCESS",

    responseValidated:
      true,

    availableAtRule:
      "FIRST_OBSERVED_BY_PIPELINE"
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("Brent market fetch");
  console.log("------------------");
  console.log(`Source: ${SOURCE_ID}`);
  console.log(`Series: ${SERIES_ID}`);
  console.log(
    `Observation date: ${latest.observationDate}`
  );
  console.log(
    `Value: ${latest.value} USD/barrel`
  );
  console.log(
    `AvailableAt: ${executionTimestamp}`
  );
  console.log(
    "AvailableAt protection: ENABLED"
  );
}

main().catch((error) => {
  console.error("Brent fetch failed:");
  console.error(error);
  process.exit(1);
});
