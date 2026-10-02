import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-availability-analysis.json",
  import.meta.url
);

const DAY_MS =
  24 * 60 * 60 * 1000;

async function readJson(file, label) {
  const raw =
    await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Invalid JSON in ${label}`
    );
  }
}

function dateTime(value) {
  const time =
    new Date(
      `${value}T00:00:00.000Z`
    ).getTime();

  if (!Number.isFinite(time)) {
    throw new Error(
      `Invalid date: ${value}`
    );
  }

  return time;
}

function calendarLagDays(
  observationDate,
  realtimeStart
) {
  return Math.round(
    (
      dateTime(realtimeStart) -
      dateTime(observationDate)
    ) / DAY_MS
  );
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 1
  ) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}

function mean(values) {
  if (values.length === 0) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / values.length
  );
}

async function main() {
  const analysisTimestamp =
    new Date().toISOString();

  const input =
    await readJson(
      INPUT_FILE,
      "brent-alfred-admission-ready.json"
    );

  if (
    !Array.isArray(
      input.preparedCandidates
    )
  ) {
    throw new Error(
      "preparedCandidates array is missing."
    );
  }

  const seen =
    new Set();

  const lags = [];

  const lagDistribution = {};

  const unusualLagObservations = [];

  let earliestObservationDate =
    null;

  let latestObservationDate =
    null;

  let earliestRealtimeStart =
    null;

  let latestRealtimeStart =
    null;

  for (
    const candidate of
    input.preparedCandidates
  ) {
    const observationDate =
      candidate.observationDate;

    const realtimeStart =
      candidate
        .availableAtEvidence
        ?.realtimeStart;

    if (
      typeof observationDate !==
        "string" ||
      typeof realtimeStart !==
        "string"
    ) {
      throw new Error(
        "Candidate is missing observationDate or realtimeStart."
      );
    }

    const key =
      `${candidate.sourceId}|` +
      `${candidate.seriesId}|` +
      `${observationDate}`;

    if (seen.has(key)) {
      throw new Error(
        `Duplicate candidate: ${key}`
      );
    }

    seen.add(key);

    const lag =
      calendarLagDays(
        observationDate,
        realtimeStart
      );

    lags.push(lag);

    const lagKey =
      String(lag);

    lagDistribution[lagKey] =
      (lagDistribution[lagKey] || 0) +
      1;

    if (
      lag < 0 ||
      lag > 7
    ) {
      unusualLagObservations.push({
        observationDate,
        realtimeStart,
        availableAt:
          candidate.availableAt,
        lagCalendarDays:
          lag,
        value:
          candidate.value
      });
    }

    if (
      earliestObservationDate === null ||
      observationDate <
        earliestObservationDate
    ) {
      earliestObservationDate =
        observationDate;
    }

    if (
      latestObservationDate === null ||
      observationDate >
        latestObservationDate
    ) {
      latestObservationDate =
        observationDate;
    }

    if (
      earliestRealtimeStart === null ||
      realtimeStart <
        earliestRealtimeStart
    ) {
      earliestRealtimeStart =
        realtimeStart;
    }

    if (
      latestRealtimeStart === null ||
      realtimeStart >
        latestRealtimeStart
    ) {
      latestRealtimeStart =
        realtimeStart;
    }
  }

  const sortedLags =
    [...lags].sort(
      (a, b) => a - b
    );

  const negativeLagCount =
    lags.filter(
      (lag) => lag < 0
    ).length;

  const sameDayCount =
    lags.filter(
      (lag) => lag === 0
    ).length;

  const oneDayCount =
    lags.filter(
      (lag) => lag === 1
    ).length;

  const twoDayCount =
    lags.filter(
      (lag) => lag === 2
    ).length;

  const threeDayCount =
    lags.filter(
      (lag) => lag === 3
    ).length;

  const fourToSevenDayCount =
    lags.filter(
      (lag) =>
        lag >= 4 &&
        lag <= 7
    ).length;

  const overSevenDayCount =
    lags.filter(
      (lag) => lag > 7
    ).length;

  const output = {
    schemaVersion: "1.0",

    status:
      "AVAILABILITY_ANALYSIS_NOT_ADMISSION",

    analysisTimestamp,

    sourceDataset:
      "brent-alfred-admission-ready.json",

    summary: {
      observationsAnalyzed:
        lags.length,

      duplicateObservations:
        input.preparedCandidates.length -
        seen.size,

      earliestObservationDate,

      latestObservationDate,

      earliestRealtimeStart,

      latestRealtimeStart
    },

    lagMethod: {
      definition:
        "Calendar-day difference between ALFRED realtimeStart and observationDate.",

      interpretation:
        "This measures the date-level delay encoded by the ALFRED realtime_start field. It does not infer an intraday publication time.",

      availableAtConvention:
        "realtimeStart at 23:59:59.999 UTC remains the conservative candidate AvailableAt convention."
    },

    lagStatistics: {
      minimumCalendarDays:
        sortedLags.length
          ? sortedLags[0]
          : null,

      maximumCalendarDays:
        sortedLags.length
          ? sortedLags[
              sortedLags.length - 1
            ]
          : null,

      meanCalendarDays:
        mean(lags),

      medianCalendarDays:
        median(lags),

      negativeLagCount,

      sameDayCount,

      oneDayCount,

      twoDayCount,

      threeDayCount,

      fourToSevenDayCount,

      overSevenDayCount
    },

    lagDistribution,

    unusualLagRule:
      "lagCalendarDays < 0 or > 7",

    unusualLagObservations,

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
      "This artifact is diagnostic only.",
      "No candidate is admitted by this analysis.",
      "The analysis uses the ALFRED realtimeStart evidence retained with each prepared candidate.",
      "Calendar-day lag is not equivalent to exact publication latency.",
      "No intraday availability time is invented.",
      "Unusual lags are retained for inspection rather than automatically corrected.",
      "Human methodological approval remains false.",
      "Calibration and official HESI remain unchanged."
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
    "ALFRED Brent availability analysis"
  );

  console.log(
    "----------------------------------"
  );

  console.log(
    `Observations analyzed: ${lags.length}`
  );

  console.log(
    `Duplicates: ${
      input.preparedCandidates.length -
      seen.size
    }`
  );

  console.log(
    `Lag minimum: ${
      output.lagStatistics
        .minimumCalendarDays
    } days`
  );

  console.log(
    `Lag median: ${
      output.lagStatistics
        .medianCalendarDays
    } days`
  );

  console.log(
    `Lag mean: ${
      output.lagStatistics
        .meanCalendarDays
    } days`
  );

  console.log(
    `Lag maximum: ${
      output.lagStatistics
        .maximumCalendarDays
    } days`
  );

  console.log(
    `Negative lags: ${negativeLagCount}`
  );

  console.log(
    `Lags > 7 days: ${overSevenDayCount}`
  );

  console.log(
    `Unusual observations: ${unusualLagObservations.length}`
  );

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
    "ALFRED availability analysis failed:"
  );

  console.error(error);

  process.exit(1);
});
