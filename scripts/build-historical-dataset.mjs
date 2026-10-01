import { readFile, writeFile } from "node:fs/promises";

const HISTORICAL_FILE = new URL(
  "../data/historical-observations.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/historical-dataset.json",
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

function parseTimestamp(value, label) {
  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) {
    throw new Error(`Invalid timestamp: ${label}`);
  }

  return time;
}

function observationKey(observation) {
  return (
    `${observation.sourceId}|` +
    `${observation.seriesId}|` +
    `${observation.observationDate}`
  );
}

function compareObservations(a, b) {
  const dateDifference =
    parseTimestamp(
      a.observationDate,
      `${a.sourceId} observationDate`
    ) -
    parseTimestamp(
      b.observationDate,
      `${b.sourceId} observationDate`
    );

  if (dateDifference !== 0) {
    return dateDifference;
  }

  return (
    parseTimestamp(
      a.availableAt,
      `${a.sourceId} availableAt`
    ) -
    parseTimestamp(
      b.availableAt,
      `${b.sourceId} availableAt`
    )
  );
}

async function main() {
  const buildTimestamp =
    new Date().toISOString();

  const historical = await readJson(
    HISTORICAL_FILE,
    "historical-observations.json"
  );

  if (!Array.isArray(historical.observations)) {
    throw new Error(
      "Historical observations array is missing."
    );
  }

  const seen = new Set();

  const observations = [];

  for (const observation of historical.observations) {
    if (!observation.sourceId) {
      throw new Error(
        "Historical observation has no sourceId."
      );
    }

    if (!observation.seriesId) {
      throw new Error(
        `${observation.sourceId} has no seriesId.`
      );
    }

    if (!observation.observationDate) {
      throw new Error(
        `${observation.sourceId} has no observationDate.`
      );
    }

    if (!observation.availableAt) {
      throw new Error(
        `${observation.sourceId} has no AvailableAt.`
      );
    }

    if (
      typeof observation.value !== "number" ||
      !Number.isFinite(observation.value)
    ) {
      throw new Error(
        `${observation.sourceId} has an invalid value.`
      );
    }

    parseTimestamp(
      observation.observationDate,
      `${observation.sourceId} observationDate`
    );

    parseTimestamp(
      observation.availableAt,
      `${observation.sourceId} availableAt`
    );

    const key =
      observationKey(observation);

    if (seen.has(key)) {
      throw new Error(
        `Duplicate historical observation: ${key}`
      );
    }

    seen.add(key);

    observations.push({
      ...observation
    });
  }

  observations.sort(compareObservations);

  const sourceCounts = {};

  for (const observation of observations) {
    sourceCounts[observation.sourceId] =
      (sourceCounts[observation.sourceId] || 0) + 1;
  }

  const availableAtValues =
    observations.map((observation) =>
      parseTimestamp(
        observation.availableAt,
        `${observation.sourceId} availableAt`
      )
    );

  const earliestAvailableAt =
    availableAtValues.length > 0
      ? new Date(
          Math.min(...availableAtValues)
        ).toISOString()
      : null;

  const latestAvailableAt =
    availableAtValues.length > 0
      ? new Date(
          Math.max(...availableAtValues)
        ).toISOString()
      : null;

  const output = {
    schemaVersion: "1.0",
    status: "RESEARCH_DATASET_NOT_CALIBRATED",
    buildTimestamp,
    leakageProtection: "ENABLED",

    availableAtPolicy:
      "Every record retains its original AvailableAt timestamp from the leakage-safe historical store. No historical availability timestamp is reconstructed, moved backward, or invented.",

    summary: {
      observationCount: observations.length,
      sourceCounts,
      earliestAvailableAt,
      latestAvailableAt
    },

    observations,

    calibrationReadiness: {
      ready: false,
      reason:
        "Dataset construction alone does not establish sufficient historical depth for calibration or out-of-sample validation."
    },

    promotion: {
      officialHesiUpdated: false,
      dashboardOfficialHesiUpdated: false
    },

    notes: [
      "This file is derived only from the admitted leakage-safe historical observation store.",
      "observationDate and availableAt remain separate concepts.",
      "No synthetic historical observations are generated.",
      "No AvailableAt timestamp is backfilled or reconstructed.",
      "The dataset must not be interpreted as calibration-ready merely because it was successfully built.",
      "Official HESI must remain unchanged until sufficient historical depth, chronological validation and out-of-sample testing are completed."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("HESI historical research dataset");
  console.log("--------------------------------");
  console.log(
    `Build timestamp: ${buildTimestamp}`
  );
  console.log(
    `Observations: ${observations.length}`
  );
  console.log(
    `Sources: ${Object.keys(sourceCounts).length}`
  );
  console.log(
    `Earliest AvailableAt: ${earliestAvailableAt}`
  );
  console.log(
    `Latest AvailableAt: ${latestAvailableAt}`
  );
  console.log(
    "Leakage protection: ENABLED"
  );
  console.log(
    "Synthetic historical observations: NO"
  );
  console.log(
    "AvailableAt reconstruction: NO"
  );
  console.log(
    "Calibration ready: NO"
  );
  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "Historical dataset build failed:"
  );
  console.error(error);
  process.exit(1);
});
