import { readFile, writeFile } from "node:fs/promises";

const AVAILABILITY_FILE = new URL(
  "../data/brent-alfred-availability-analysis.json",
  import.meta.url
);

const METHODOLOGY_FILE = new URL(
  "../data/brent-alfred-methodology-evidence.json",
  import.meta.url
);

const YEAR_FILE = new URL(
  "../data/brent-alfred-lag-by-year.json",
  import.meta.url
);

const WEEKDAY_FILE = new URL(
  "../data/brent-alfred-weekday-pattern.json",
  import.meta.url
);

const STAGING_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-admission-decision.json",
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

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const availability = await readJson(
    AVAILABILITY_FILE,
    "brent-alfred-availability-analysis.json"
  );

  const methodology = await readJson(
    METHODOLOGY_FILE,
    "brent-alfred-methodology-evidence.json"
  );

  const yearly = await readJson(
    YEAR_FILE,
    "brent-alfred-lag-by-year.json"
  );

  const weekday = await readJson(
    WEEKDAY_FILE,
    "brent-alfred-weekday-pattern.json"
  );

  const staging = await readJson(
    STAGING_FILE,
    "brent-alfred-admission-ready.json"
  );

  const preparedCount =
    Array.isArray(staging.preparedCandidates)
      ? staging.preparedCandidates.length
      : 0;

  requireCondition(
    preparedCount > 0,
    "No prepared ALFRED candidates found."
  );

  requireCondition(
    availability.observationsAnalyzed === preparedCount,
    "Availability-analysis count does not match staging."
  );

  requireCondition(
    weekday.observationsAnalyzed === preparedCount,
    "Weekday-analysis count does not match staging."
  );

  requireCondition(
    availability.negativeLagCount === 0,
    "Negative lags remain in prepared candidates."
  );

  requireCondition(
    weekday.negativeLagCount === 0,
    "Weekday diagnostic contains negative lags."
  );

  const methodologyDecision =
    methodology.methodologyDecision || {};

  requireCondition(
    methodologyDecision.humanMethodologicalApproval === false,
    "Methodology evidence unexpectedly contains human approval."
  );

  requireCondition(
    methodologyDecision.admissionAuthorized === false,
    "Methodology evidence unexpectedly authorizes admission."
  );

  const weekdayRealtime =
    weekday.byRealtimeStartWeekday || {};

  const realtimeWednesdayCount =
    weekdayRealtime.Wednesday?.observations || 0;

  const realtimeThursdayCount =
    weekdayRealtime.Thursday?.observations || 0;

  const wednesdayThursdayCount =
    realtimeWednesdayCount +
    realtimeThursdayCount;

  const wednesdayThursdayShare =
    preparedCount > 0
      ? wednesdayThursdayCount / preparedCount
      : null;

  const output = {
    schemaVersion: "1.0",

    status:
      "METHODOLOGY_DECISION_PENDING_HUMAN_APPROVAL",

    decisionTimestamp:
      new Date().toISOString(),

    sourceDataset:
      "brent-alfred-admission-ready.json",

    candidateSummary: {
      preparedCandidates: preparedCount,

      negativeLagCount:
        availability.negativeLagCount,

      overSevenDayLagCount:
        availability.lagStatistics
          ?.overSevenDayCount ?? null,

      medianLagCalendarDays:
        availability.lagStatistics
          ?.medianLagCalendarDays ?? null,

      maximumLagCalendarDays:
        availability.lagStatistics
          ?.maximumLagCalendarDays ?? null
    },

    evidenceSummary: {
      officialDocumentationRecorded: true,

      realtimeStartSupportedAtDateLevel: true,

      initialReleaseQuerySupported: true,

      intradayAvailabilityEstablished: false,

      conservativeAvailableAtConvention:
        "ALFRED realtime_start date at 23:59:59.999 UTC",

      negativeLagsAfterMethodReview:
        availability.negativeLagCount,

      yearlyPatternReviewed: true,

      weekdayPatternReviewed: true,

      realtimeStartWednesdayCount:
        realtimeWednesdayCount,

      realtimeStartThursdayCount:
        realtimeThursdayCount,

      realtimeStartWednesdayThursdayCount:
        wednesdayThursdayCount,

      realtimeStartWednesdayThursdayShare:
        wednesdayThursdayShare,

      interpretation:
        "The reviewed sample shows a strong recurring calendar structure in ALFRED realtime_start dates. Long calendar lags are retained as observed and are not automatically treated as errors or shifted backward."
    },

    unresolvedLimitations: [
      "ALFRED evidence is date-level and does not establish an exact intraday publication timestamp.",
      "The end-of-day UTC AvailableAt value is a conservative research convention rather than a provider-supplied timestamp.",
      "One previously identified candidate with AvailableAt preceding its observation date remains excluded.",
      "This artifact does not prove predictive validity or model calibration.",
      "Admission into the leakage-safe historical store still requires an explicit human methodological decision."
    ],

    proposedAdmissionRule: {
      eligibleDataset:
        "Only candidates already present in brent-alfred-admission-ready.json",

      availableAtRule:
        "Retain each candidate's existing AvailableAt without backward adjustment.",

      anomalyRule:
        "Do not admit candidates previously excluded by automated methodology checks.",

      revisionRule:
        "Use the reviewed initial-release ALFRED representation; do not substitute later revised values.",

      intradayClaim:
        "NONE",

      automaticAdmission:
        false
    },

    humanDecision: {
      methodologicalApproval:
        false,

      admissionAuthorized:
        false,

      decisionRecorded:
        false,

      decisionBasis:
        null
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
      "This file consolidates evidence for a later explicit admission decision.",
      "It does not admit historical observations.",
      "It does not modify the leakage-safe historical store.",
      "It does not modify the calibration dataset.",
      "It does not modify official HESI.",
      "No historical AvailableAt value is moved backward.",
      "Human methodological approval remains required."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("ALFRED admission decision gate");
  console.log("------------------------------");

  console.log(
    `Prepared candidates: ${preparedCount}`
  );

  console.log(
    `Negative lags: ${availability.negativeLagCount}`
  );

  console.log(
    `Wednesday realtime_start: ${realtimeWednesdayCount}`
  );

  console.log(
    `Thursday realtime_start: ${realtimeThursdayCount}`
  );

  console.log(
    `Wednesday + Thursday share: ${
      (
        wednesdayThursdayShare * 100
      ).toFixed(2)
    }%`
  );

  console.log(
    "Human methodological approval: NO"
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
    "ALFRED admission decision gate failed:"
  );

  console.error(error);

  process.exit(1);
});
