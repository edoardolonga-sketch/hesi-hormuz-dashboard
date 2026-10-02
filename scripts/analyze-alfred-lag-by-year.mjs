import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-lag-by-year.json",
  import.meta.url
);

const DAY_MS = 24 * 60 * 60 * 1000;

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function toTime(date) {
  const time = new Date(
    `${date}T00:00:00.000Z`
  ).getTime();

  if (!Number.isFinite(time)) {
    throw new Error(`Invalid date: ${date}`);
  }

  return time;
}

function lagDays(observationDate, realtimeStart) {
  return Math.round(
    (toTime(realtimeStart) -
      toTime(observationDate)) /
      DAY_MS
  );
}

function mean(values) {
  if (!values.length) return null;

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

function median(values) {
  if (!values.length) return null;

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const middle = Math.floor(
    sorted.length / 2
  );

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}

async function main() {
  const input = await readJson(
    INPUT_FILE,
    "brent-alfred-admission-ready.json"
  );

  if (
    !Array.isArray(input.preparedCandidates)
  ) {
    throw new Error(
      "preparedCandidates array is missing."
    );
  }

  const byYear = {};

  for (const candidate of input.preparedCandidates) {
    const observationDate =
      candidate.observationDate;

    const realtimeStart =
      candidate.availableAtEvidence
        ?.realtimeStart;

    if (
      typeof observationDate !== "string" ||
      typeof realtimeStart !== "string"
    ) {
      throw new Error(
        "Candidate is missing observationDate or realtimeStart."
      );
    }

    const year =
      observationDate.slice(0, 4);

    const lag = lagDays(
      observationDate,
      realtimeStart
    );

    if (!byYear[year]) {
      byYear[year] = [];
    }

    byYear[year].push(lag);
  }

  const yearlyAnalysis = {};

  for (
    const year of Object.keys(byYear).sort()
  ) {
    const lags = byYear[year];

    const distribution = {};

    for (const lag of lags) {
      distribution[String(lag)] =
        (distribution[String(lag)] || 0) +
        1;
    }

    yearlyAnalysis[year] = {
      observations: lags.length,

      minimumLagCalendarDays:
        Math.min(...lags),

      medianLagCalendarDays:
        median(lags),

      meanLagCalendarDays:
        mean(lags),

      maximumLagCalendarDays:
        Math.max(...lags),

      negativeLagCount:
        lags.filter(
          (lag) => lag < 0
        ).length,

      overSevenDayCount:
        lags.filter(
          (lag) => lag > 7
        ).length,

      overSevenDayShare:
        lags.filter(
          (lag) => lag > 7
        ).length / lags.length,

      lagDistribution:
        distribution
    };
  }

  const output = {
    schemaVersion: "1.0",

    status:
      "TEMPORAL_DIAGNOSTIC_NOT_ADMISSION",

    analysisTimestamp:
      new Date().toISOString(),

    sourceDataset:
      "brent-alfred-admission-ready.json",

    observationsAnalyzed:
      input.preparedCandidates.length,

    yearRange: {
      first:
        Object.keys(yearlyAnalysis)[0],

      last:
        Object.keys(yearlyAnalysis).at(-1)
    },

    methodology: {
      grouping:
        "Calendar year of observationDate",

      lagDefinition:
        "Calendar-day difference between ALFRED realtimeStart and observationDate.",

      purpose:
        "Detect temporal changes in the ALFRED date-level availability pattern.",

      admissionEffect:
        "NONE"
    },

    yearlyAnalysis,

    methodologyDecision: {
      humanMethodologicalApproval:
        false,

      admissionAuthorized:
        false,

      historicalAdmissionPerformed:
        false
    },

    promotion: {
      historicalStoreUpdated:
        false,

      calibrationDatasetUpdated:
        false,

      officialHesiUpdated:
        false
    },

    notes: [
      "This is a temporal diagnostic only.",
      "No observation is admitted by this script.",
      "Lag patterns are preserved rather than normalized.",
      "A lag above seven days is not automatically treated as invalid.",
      "No intraday publication time is inferred.",
      "Human methodological approval remains false.",
      "Official HESI remains unchanged."
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
    "ALFRED lag analysis by year"
  );

  console.log(
    "---------------------------"
  );

  console.log(
    `Observations analyzed: ${output.observationsAnalyzed}`
  );

  for (
    const [year, stats] of
    Object.entries(yearlyAnalysis)
  ) {
    console.log(
      `${year}: ` +
        `n=${stats.observations}, ` +
        `median=${stats.medianLagCalendarDays}, ` +
        `mean=${stats.meanLagCalendarDays.toFixed(2)}, ` +
        `max=${stats.maximumLagCalendarDays}, ` +
        `>7=${stats.overSevenDayCount}`
    );
  }

  console.log(
    "Admission authorized: NO"
  );

  console.log(
    "Historical store modified: NO"
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
    "ALFRED yearly lag analysis failed:"
  );

  console.error(error);

  process.exit(1);
});
