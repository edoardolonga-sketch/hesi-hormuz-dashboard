import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-weekday-pattern.json",
  import.meta.url
);

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${label}`);
  }
}

function dateTime(value) {
  const time = new Date(
    `${value}T00:00:00.000Z`
  ).getTime();

  if (!Number.isFinite(time)) {
    throw new Error(`Invalid date: ${value}`);
  }

  return time;
}

function weekday(value) {
  return WEEKDAYS[
    new Date(
      `${value}T00:00:00.000Z`
    ).getUTCDay()
  ];
}

function lagDays(
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

function mean(values) {
  if (!values.length) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length
  );
}

function median(values) {
  if (!values.length) {
    return null;
  }

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

function createStats() {
  return {
    count: 0,
    lags: [],
    overSevenDayCount: 0
  };
}

function summarize(stats) {
  if (!stats.count) {
    return {
      observations: 0,
      minimumLagCalendarDays: null,
      medianLagCalendarDays: null,
      meanLagCalendarDays: null,
      maximumLagCalendarDays: null,
      overSevenDayCount: 0,
      overSevenDayShare: 0
    };
  }

  return {
    observations: stats.count,

    minimumLagCalendarDays:
      Math.min(...stats.lags),

    medianLagCalendarDays:
      median(stats.lags),

    meanLagCalendarDays:
      mean(stats.lags),

    maximumLagCalendarDays:
      Math.max(...stats.lags),

    overSevenDayCount:
      stats.overSevenDayCount,

    overSevenDayShare:
      stats.overSevenDayCount /
      stats.count
  };
}

async function main() {
  const input = await readJson(
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

  const observationWeekdays = {};
  const realtimeStartWeekdays = {};
  const weekdayPairs = {};

  for (const day of WEEKDAYS) {
    observationWeekdays[day] =
      createStats();

    realtimeStartWeekdays[day] =
      createStats();
  }

  let negativeLagCount = 0;

  for (
    const candidate of
    input.preparedCandidates
  ) {
    const observationDate =
      candidate.observationDate;

    const realtimeStart =
      candidate.availableAtEvidence
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

    const lag = lagDays(
      observationDate,
      realtimeStart
    );

    const observationWeekday =
      weekday(observationDate);

    const realtimeStartWeekday =
      weekday(realtimeStart);

    if (lag < 0) {
      negativeLagCount += 1;
    }

    const observationStats =
      observationWeekdays[
        observationWeekday
      ];

    observationStats.count += 1;
    observationStats.lags.push(lag);

    if (lag > 7) {
      observationStats
        .overSevenDayCount += 1;
    }

    const realtimeStats =
      realtimeStartWeekdays[
        realtimeStartWeekday
      ];

    realtimeStats.count += 1;
    realtimeStats.lags.push(lag);

    if (lag > 7) {
      realtimeStats
        .overSevenDayCount += 1;
    }

    const pair =
      `${observationWeekday} -> ` +
      `${realtimeStartWeekday}`;

    if (!weekdayPairs[pair]) {
      weekdayPairs[pair] = {
        count: 0,
        lags: {}
      };
    }

    weekdayPairs[pair].count += 1;

    const lagKey = String(lag);

    weekdayPairs[pair].lags[lagKey] =
      (
        weekdayPairs[pair]
          .lags[lagKey] || 0
      ) + 1;
  }

  const observationSummary = {};
  const realtimeSummary = {};

  for (const day of WEEKDAYS) {
    observationSummary[day] =
      summarize(
        observationWeekdays[day]
      );

    realtimeSummary[day] =
      summarize(
        realtimeStartWeekdays[day]
      );
  }

  const output = {
    schemaVersion: "1.0",

    status:
      "WEEKDAY_DIAGNOSTIC_NOT_ADMISSION",

    analysisTimestamp:
      new Date().toISOString(),

    sourceDataset:
      "brent-alfred-admission-ready.json",

    observationsAnalyzed:
      input.preparedCandidates.length,

    methodology: {
      observationWeekday:
        "UTC weekday of observationDate.",

      realtimeStartWeekday:
        "UTC weekday of ALFRED realtimeStart.",

      lagDefinition:
        "Calendar-day difference between realtimeStart and observationDate.",

      purpose:
        "Test whether ALFRED availability lags exhibit systematic weekday/calendar structure.",

      admissionEffect:
        "NONE"
    },

    negativeLagCount,

    byObservationWeekday:
      observationSummary,

    byRealtimeStartWeekday:
      realtimeSummary,

    weekdayPairs,

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
      "No observation is admitted by this analysis.",
      "Weekday patterns are measured in UTC at date level.",
      "No intraday publication time is inferred.",
      "A lag above seven calendar days is not automatically invalid.",
      "Observed realtimeStart dates are retained without backward adjustment.",
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
    "ALFRED weekday-pattern analysis"
  );

  console.log(
    "-------------------------------"
  );

  console.log(
    `Observations analyzed: ${output.observationsAnalyzed}`
  );

  console.log(
    `Negative lags: ${negativeLagCount}`
  );

  console.log("");
  console.log(
    "By observation weekday:"
  );

  for (const day of WEEKDAYS) {
    const stats =
      observationSummary[day];

    if (!stats.observations) {
      continue;
    }

    console.log(
      `${day}: ` +
        `n=${stats.observations}, ` +
        `median=${stats.medianLagCalendarDays}, ` +
        `mean=${stats.meanLagCalendarDays.toFixed(2)}, ` +
        `>7=${stats.overSevenDayCount}`
    );
  }

  console.log("");
  console.log(
    "By realtime_start weekday:"
  );

  for (const day of WEEKDAYS) {
    const stats =
      realtimeSummary[day];

    if (!stats.observations) {
      continue;
    }

    console.log(
      `${day}: ` +
        `n=${stats.observations}, ` +
        `median=${stats.medianLagCalendarDays}, ` +
        `mean=${stats.meanLagCalendarDays.toFixed(2)}, ` +
        `>7=${stats.overSevenDayCount}`
    );
  }

  console.log("");
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
    "ALFRED weekday-pattern analysis failed:"
  );

  console.error(error);

  process.exit(1);
});
