import { readFile, writeFile } from "node:fs/promises";

const DATASET_FILE = new URL(
  "../data/historical-dataset.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/historical-temporal-coverage.json",
  import.meta.url
);

const BRENT_SOURCE_ID =
  "brent_market";

const BRENT_SERIES_ID =
  "DCOILBRENTEU";

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validDate(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value))
  );
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const middle = Math.floor(
    sorted.length / 2
  );

  if (sorted.length % 2 === 0) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

async function main() {
  const dataset = await readJson(
    DATASET_FILE,
    "historical-dataset.json"
  );

  requireCondition(
    dataset.status ===
      "RESEARCH_DATASET_NOT_CALIBRATED",
    "Historical dataset is not in the expected research state."
  );

  requireCondition(
    dataset.leakageProtection === "ENABLED",
    "Historical dataset leakage protection is not enabled."
  );

  requireCondition(
    Array.isArray(dataset.observations),
    "Historical dataset observations array is missing."
  );

  /*
   * Do NOT hardcode the total historical observation count.
   *
   * The historical store is intentionally extensible.
   * Future defensible observations from CFTC, EIA or other
   * approved sources must not make this analysis fail merely
   * because the dataset has grown.
   */
  requireCondition(
    dataset.observations.length > 0,
    "Historical dataset contains no observations."
  );

  const brent =
    dataset.observations.filter(
      (observation) =>
        observation.sourceId ===
          BRENT_SOURCE_ID &&
        observation.seriesId ===
          BRENT_SERIES_ID
    );

  /*
   * Brent is the series analyzed by this artifact, but its
   * count must also be data-driven rather than frozen to a
   * historical snapshot such as 3939 observations.
   */
  requireCondition(
    brent.length > 0,
    "Historical dataset contains no Brent observations."
  );

  /*
   * Always analyze Brent in chronological observation-date
   * order so calendar-gap calculations are deterministic and
   * independent of storage order.
   */
  const sortedBrent =
    [...brent].sort(
      (a, b) =>
        a.observationDate.localeCompare(
          b.observationDate
        )
    );

  const keys = new Set();

  const lagDays = [];

  const observationsByYear = {};

  let previousObservationDate = null;

  let maximumCalendarGapDays = 0;
  let maximumCalendarGap = null;

  for (const observation of sortedBrent) {
    requireCondition(
      validDate(observation.observationDate),
      "Invalid Brent observationDate."
    );

    requireCondition(
      validDate(observation.availableAt),
      "Invalid Brent AvailableAt."
    );

    requireCondition(
      typeof observation.value === "number" &&
        Number.isFinite(observation.value),
      "Invalid Brent historical value."
    );

    const key =
      `${observation.sourceId}|` +
      `${observation.seriesId}|` +
      `${observation.observationDate}`;

    requireCondition(
      !keys.has(key),
      `Duplicate Brent historical key: ${key}`
    );

    keys.add(key);

    const observationDateMs =
      Date.parse(
        `${observation.observationDate}T00:00:00Z`
      );

    const availableAtMs =
      Date.parse(
        observation.availableAt
      );

    requireCondition(
      availableAtMs >= observationDateMs,
      `AvailableAt precedes observationDate: ${observation.observationDate}`
    );

    const lag =
      (availableAtMs - observationDateMs) /
      86400000;

    lagDays.push(lag);

    const year =
      observation.observationDate.slice(
        0,
        4
      );

    observationsByYear[year] =
      (observationsByYear[year] || 0) + 1;

    if (previousObservationDate !== null) {
      const previousMs =
        Date.parse(
          `${previousObservationDate}T00:00:00Z`
        );

      const gapDays =
        (observationDateMs - previousMs) /
        86400000;

      requireCondition(
        gapDays >= 0,
        "Brent observations are not in chronological order."
      );

      if (
        gapDays >
        maximumCalendarGapDays
      ) {
        maximumCalendarGapDays =
          gapDays;

        maximumCalendarGap = {
          from:
            previousObservationDate,

          to:
            observation.observationDate,

          calendarDays:
            gapDays
        };
      }
    }

    previousObservationDate =
      observation.observationDate;
  }

  const earliest =
    sortedBrent[0];

  const latest =
    sortedBrent[
      sortedBrent.length - 1
    ];

  const sortedLagDays =
    [...lagDays].sort(
      (a, b) => a - b
    );

  const sameDay =
    lagDays.filter(
      (lag) => lag < 1
    ).length;

  const oneToThreeDays =
    lagDays.filter(
      (lag) =>
        lag >= 1 &&
        lag < 4
    ).length;

  const fourToSevenDays =
    lagDays.filter(
      (lag) =>
        lag >= 4 &&
        lag < 8
    ).length;

  const moreThanSevenDays =
    lagDays.filter(
      (lag) => lag >= 8
    ).length;

  /*
   * Source counts are descriptive and data-driven.
   * They allow the artifact to remain valid as new approved
   * historical sources are added.
   */
  const observationsBySource = {};

  for (
    const observation
    of dataset.observations
  ) {
    const sourceId =
      observation.sourceId ??
      "UNKNOWN_SOURCE";

    observationsBySource[sourceId] =
      (observationsBySource[sourceId] || 0) +
      1;
  }

  const output = {
    schemaVersion: "1.1",

    status:
      "TEMPORAL_COVERAGE_ANALYZED_NOT_CALIBRATED",

    analysisTimestamp:
      new Date().toISOString(),

    sourceDataset:
      "historical-dataset.json",

    safeguards: {
      leakageProtection:
        dataset.leakageProtection,

      fixedHistoricalObservationCountRequired:
        false,

      fixedBrentObservationCountRequired:
        false,

      datasetModified:
        false,

      calibrationPerformed:
        false,

      modelWeightsModified:
        false,

      officialHesiModified:
        false
    },

    summary: {
      totalHistoricalObservations:
        dataset.observations.length,

      brentObservations:
        brent.length,

      nonBrentObservations:
        dataset.observations.length -
        brent.length,

      earliestBrentObservationDate:
        earliest.observationDate,

      latestBrentObservationDate:
        latest.observationDate,

      earliestBrentAvailableAt:
        earliest.availableAt,

      latestBrentAvailableAt:
        latest.availableAt,

      uniqueBrentKeys:
        keys.size,

      yearsCovered:
        Object.keys(
          observationsByYear
        ).length
    },

    observationsBySource,

    availabilityLagDays: {
      minimum:
        sortedLagDays[0],

      maximum:
        sortedLagDays[
          sortedLagDays.length - 1
        ],

      mean:
        lagDays.reduce(
          (sum, value) =>
            sum + value,
          0
        ) / lagDays.length,

      median:
        median(lagDays),

      sameDay,

      oneToThreeDays,

      fourToSevenDays,

      moreThanSevenDays
    },

    maximumCalendarGap,

    observationsByYear,

    interpretationLimits: [
      "This artifact describes temporal coverage only.",
      "Historical observation counts are data-driven and are not frozen to a previous dataset size.",
      "The presence of additional approved historical sources does not invalidate the Brent temporal-coverage analysis.",
      "It does not determine whether the historical sample is sufficient for calibration.",
      "Calendar gaps are not automatically data-quality failures because Brent observations are not expected on every calendar day.",
      "AvailableAt lag is measured from 00:00 UTC on observationDate to the stored AvailableAt timestamp.",
      "The analysis does not alter historical observations or reconstruct availability timestamps.",
      "No model calibration, backtest, weight optimization or official HESI modification is performed."
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
    "Historical temporal coverage analysis"
  );

  console.log(
    "-------------------------------------"
  );

  console.log(
    `Historical observations: ${output.summary.totalHistoricalObservations}`
  );

  console.log(
    `Brent observations: ${output.summary.brentObservations}`
  );

  console.log(
    `Non-Brent observations: ${output.summary.nonBrentObservations}`
  );

  console.log(
    `Earliest Brent date: ${output.summary.earliestBrentObservationDate}`
  );

  console.log(
    `Latest Brent date: ${output.summary.latestBrentObservationDate}`
  );

  console.log(
    `Years covered: ${output.summary.yearsCovered}`
  );

  console.log(
    `Minimum AvailableAt lag: ${output.availabilityLagDays.minimum}`
  );

  console.log(
    `Median AvailableAt lag: ${output.availabilityLagDays.median}`
  );

  console.log(
    `Maximum AvailableAt lag: ${output.availabilityLagDays.maximum}`
  );

  console.log(
    `Maximum calendar gap: ${output.maximumCalendarGap?.calendarDays ?? "N/A"} days`
  );

  console.log(
    "Fixed historical observation count required: NO"
  );

  console.log(
    "Fixed Brent observation count required: NO"
  );

  console.log(
    "Calibration performed: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "Historical temporal coverage analysis failed:"
  );

  console.error(error);

  process.exit(1);
});
