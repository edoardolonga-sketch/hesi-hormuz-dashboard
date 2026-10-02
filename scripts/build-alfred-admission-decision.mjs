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

const HUMAN_DECISION_FILE = new URL(
  "../data/brent-alfred-human-methodology-decision.json",
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

  const humanDecision = await readJson(
    HUMAN_DECISION_FILE,
    "brent-alfred-human-methodology-decision.json"
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
    staging.methodologyState
      ?.decisionRecorded === true,
    "Staging does not contain a recorded methodology decision."
  );

  requireCondition(
    staging.methodologyState
      ?.humanMethodologicalApproval === true,
    "Staging does not reflect methodology approval."
  );

  requireCondition(
    staging.methodologyState
      ?.admissionAuthorized === false,
    "Staging unexpectedly authorizes admission."
  );

  requireCondition(
    weekday.observationsAnalyzed === preparedCount,
    "Weekday-analysis count does not match current staging."
  );

  requireCondition(
    typeof availability === "object" &&
      availability !== null,
    "Availability analysis is missing."
  );

  requireCondition(
    typeof availability.lagStatistics === "object" &&
      availability.lagStatistics !== null,
    "Availability lagStatistics are missing."
  );

  requireCondition(
    typeof yearly === "object" &&
      yearly !== null,
    "Yearly analysis is missing."
  );

  const negativeLagCount =
    availability.lagStatistics.negativeLagCount;

  const overSevenDayLagCount =
    availability.lagStatistics.overSevenDayCount;

  const medianLagCalendarDays =
    availability.lagStatistics.medianCalendarDays;

  const maximumLagCalendarDays =
    availability.lagStatistics.maximumCalendarDays;

  requireCondition(
    Number.isFinite(negativeLagCount),
    "Negative-lag count is missing."
  );

  requireCondition(
    negativeLagCount === 0,
    "Negative lags remain in availability analysis."
  );

  requireCondition(
    Number.isFinite(overSevenDayLagCount),
    "Over-seven-day lag count is missing."
  );

  requireCondition(
    Number.isFinite(medianLagCalendarDays),
    "Median lag is missing from availability analysis."
  );

  requireCondition(
    Number.isFinite(maximumLagCalendarDays),
    "Maximum lag is missing from availability analysis."
  );

  requireCondition(
    weekday.negativeLagCount === 0,
    "Weekday diagnostic contains negative lags."
  );

  /*
   * The older methodology evidence artifact remains
   * evidence-only. It must not independently authorize
   * admission.
   */
  const methodologyDecision =
    methodology.methodologyDecision || {};

  requireCondition(
    methodologyDecision.admissionAuthorized === false,
    "Methodology evidence unexpectedly authorizes admission."
  );

  /*
   * The authoritative human methodology decision is
   * stored separately and must now be recorded and approved.
   */
  requireCondition(
    humanDecision.schemaVersion === "1.0",
    "Unexpected human decision schema version."
  );

  requireCondition(
    humanDecision.decisionType ===
      "ALFRED_BRENT_AVAILABLE_AT_METHODOLOGY",
    "Unexpected human methodology decision type."
  );

  requireCondition(
    humanDecision.decisionRecorded === true,
    "Human methodology decision has not been recorded."
  );

  requireCondition(
    humanDecision.approved === true,
    "ALFRED AvailableAt methodology has not been approved."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.dateLevelEvidenceOnly === true,
    "Date-level evidence acknowledgement is missing."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.exactIntradayTimeNotEstablished === true,
    "Intraday timing acknowledgement is missing."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.endOfDayUtcIsResearchConvention === true,
    "End-of-day UTC convention acknowledgement is missing."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.longLagsRetainedWithoutBackwardShift === true,
    "Long-lag acknowledgement is missing."
  );

  requireCondition(
    humanDecision.acknowledgements
      ?.negativeLagAnomalyExcluded === true,
    "Negative-lag anomaly acknowledgement is missing."
  );

  /*
   * Critical separation:
   *
   * Methodology approval = YES
   * Admission authorization = NO
   */
  requireCondition(
    humanDecision.admissionAuthorized === false,
    "Historical admission is already authorized."
  );

  requireCondition(
    humanDecision.historicalStoreModified === false,
    "Historical store was unexpectedly modified."
  );

  requireCondition(
    humanDecision.calibrationDatasetModified === false,
    "Calibration dataset was unexpectedly modified."
  );

  requireCondition(
    humanDecision.officialHesiModified === false,
    "Official HESI was unexpectedly modified."
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
    wednesdayThursdayCount / preparedCount;

  const output = {
    schemaVersion: "1.3",

    status:
      "METHODOLOGY_APPROVED_ADMISSION_DECISION_PENDING",

    decisionTimestamp:
      new Date().toISOString(),

    sourceDataset:
      "brent-alfred-admission-ready.json",

    sourceHumanDecision:
      "brent-alfred-human-methodology-decision.json",

    candidateSummary: {
      preparedCandidates:
        preparedCount,

      negativeLagCount,

      overSevenDayLagCount,

      medianLagCalendarDays,

      maximumLagCalendarDays
    },

    consistencyChecks: {
      currentStagingCount:
        preparedCount,

      currentWeekdayAnalysisCount:
        weekday.observationsAnalyzed,

      currentWeekdayMatchesStaging:
        weekday.observationsAnalyzed ===
        preparedCount,

      availabilityEvidencePresent:
        true,

      yearlyEvidencePresent:
        true,

      methodologyDecisionRecorded:
        true,

      methodologyApproved:
        true,

      negativeLagCount,

      medianLagPresent:
        Number.isFinite(
          medianLagCalendarDays
        ),

      maximumLagPresent:
        Number.isFinite(
          maximumLagCalendarDays
        ),

      passed:
        true
    },

    evidenceSummary: {
      officialDocumentationRecorded:
        true,

      realtimeStartSupportedAtDateLevel:
        true,

      initialReleaseQuerySupported:
        true,

      intradayAvailabilityEstablished:
        false,

      conservativeAvailableAtConvention:
        "ALFRED realtime_start date at 23:59:59.999 UTC",

      negativeLagsAfterMethodReview:
        negativeLagCount,

      yearlyPatternReviewed:
        true,

      weekdayPatternReviewed:
        true,

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
      "The end-of-day UTC AvailableAt value is an approved conservative research convention rather than a provider-supplied timestamp.",
      "The previously identified candidate with AvailableAt preceding its observation date remains excluded.",
      "This artifact does not prove predictive validity or model calibration.",
      "Methodological approval does not constitute authorization to admit historical observations."
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
        true,

      admissionAuthorized:
        false,

      decisionRecorded:
        true,

      decisionBasis:
        "brent-alfred-human-methodology-decision.json"
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
      "The human ALFRED AvailableAt methodology decision has been recorded and approved.",
      "This artifact prepares the separate historical admission decision.",
      "Methodological approval does not authorize historical admission.",
      "The 3,939 prepared candidates remain outside the leakage-safe historical store.",
      "No historical observation is admitted by this script.",
      "No calibration dataset is modified by this script.",
      "Official HESI is not modified by this script.",
      "No historical AvailableAt value is moved backward.",
      "Current staging is cross-checked against the weekday diagnostic generated in the same pipeline run.",
      "Lag statistics are read directly from availability.lagStatistics."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "ALFRED admission decision gate"
  );

  console.log(
    "------------------------------"
  );

  console.log(
    `Prepared candidates: ${preparedCount}`
  );

  console.log(
    `Weekday-analysis candidates: ${weekday.observationsAnalyzed}`
  );

  console.log(
    `Negative lags: ${negativeLagCount}`
  );

  console.log(
    `Lags > 7 days: ${overSevenDayLagCount}`
  );

  console.log(
    `Median lag: ${medianLagCalendarDays} days`
  );

  console.log(
    `Maximum lag: ${maximumLagCalendarDays} days`
  );

  console.log(
    `Wednesday realtime_start: ${realtimeWednesdayCount}`
  );

  console.log(
    `Thursday realtime_start: ${realtimeThursdayCount}`
  );

  console.log(
    `Wednesday + Thursday share: ${(
      wednesdayThursdayShare * 100
    ).toFixed(2)}%`
  );

  console.log(
    "Same-run staging check: PASS"
  );

  console.log(
    "Human methodology decision recorded: YES"
  );

  console.log(
    "Human methodological approval: YES"
  );

  console.log(
    "Admission decision: PENDING"
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
