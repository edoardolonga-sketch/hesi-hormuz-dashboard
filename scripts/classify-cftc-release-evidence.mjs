import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = new URL(
  "../data/cftc-ambiguous-release-review.json",
  import.meta.url
);

const METHODOLOGY_FILE = new URL(
  "../data/cftc-human-methodology-decision.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/cftc-release-evidence-classification.json",
  import.meta.url
);

const EXPECTED_INPUT_STATUS =
  "CFTC_AMBIGUOUS_RELEASES_PREPARED_FOR_HUMAN_REVIEW_NOT_ADMITTED";

const EXPECTED_SOURCE_ID =
  "cftc_cot";

const EXPECTED_SERIES_ID =
  "CFTC_WTI_PHYSICAL_MANAGED_MONEY";

const EXPECTED_MARKET_CODE =
  "067651";

const EXPECTED_AVAILABLE_AT_CONVENTION =
  "DOCUMENTED_RELEASE_DATE_CONSERVATIVE_END_OF_DAY_UTC";

const EXPECTED_AVAILABLE_AT_TIME_UTC =
  "23:59:59.999Z";

/*
 * These seven mappings come from official CFTC
 * publication schedules already preserved in the
 * upstream evidence artifact.
 *
 * They classify the earlier and later official
 * schedule versions.
 *
 * IMPORTANT:
 *
 * Under methodology 1.1, a later official schedule
 * revision may supersede an earlier official schedule
 * when it documents the release date.
 *
 * This classification script still does NOT:
 *
 * - authorize historical admission,
 * - modify the historical store,
 * - modify the point-in-time dataset,
 * - perform calibration.
 */
const SCHEDULE_CLASSIFICATION = {
  "2025-11-10": {
    initialScheduleDate: "2025-12-12",
    revisedScheduleDate: "2025-12-10"
  },

  "2025-11-18": {
    initialScheduleDate: "2025-12-16",
    revisedScheduleDate: "2025-12-12"
  },

  "2025-11-25": {
    initialScheduleDate: "2025-12-19",
    revisedScheduleDate: "2025-12-15"
  },

  "2025-12-02": {
    initialScheduleDate: "2025-12-23",
    revisedScheduleDate: "2025-12-17"
  },

  "2025-12-09": {
    initialScheduleDate: "2025-12-30",
    revisedScheduleDate: "2025-12-19"
  },

  "2025-12-16": {
    initialScheduleDate: "2026-01-06",
    revisedScheduleDate: "2025-12-23"
  },

  "2025-12-23": {
    initialScheduleDate: "2026-01-09",
    revisedScheduleDate: "2025-12-29"
  }
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(url, label) {
  const text =
    await readFile(url, "utf8");

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${label}: ${error.message}`
    );
  }
}

function isIsoDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  return Number.isFinite(
    Date.parse(
      `${value}T00:00:00.000Z`
    )
  );
}

function sameDateSet(a, b) {
  const left =
    [...a].sort();

  const right =
    [...b].sort();

  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        value === right[index]
    )
  );
}

function conservativeAvailableAt(
  releaseDate
) {
  assert(
    isIsoDate(releaseDate),
    `Invalid documented release date: ${releaseDate}.`
  );

  const availableAt =
    `${releaseDate}T${EXPECTED_AVAILABLE_AT_TIME_UTC}`;

  assert(
    Number.isFinite(
      Date.parse(availableAt)
    ),
    `Invalid conservative AvailableAt for ${releaseDate}.`
  );

  return availableAt;
}

function classifyRecord(record) {
  const mapping =
    SCHEDULE_CLASSIFICATION[
      record.observationDate
    ];

  assert(
    mapping,
    `No approved schedule classification exists for ${record.observationDate}.`
  );

  assert(
    Array.isArray(
      record.candidateReleaseDates
    ),
    `Candidate release dates missing for ${record.observationDate}.`
  );

  assert(
    record.candidateReleaseDates.length ===
      2,
    `Expected exactly two schedule candidates for ${record.observationDate}.`
  );

  const expectedDates = [
    mapping.initialScheduleDate,
    mapping.revisedScheduleDate
  ];

  assert(
    sameDateSet(
      record.candidateReleaseDates,
      expectedDates
    ),
    `Schedule candidates do not match classification evidence for ${record.observationDate}.`
  );

  assert(
    record.selectedReleaseDate ===
      null,
    `Release date already selected for ${record.observationDate}.`
  );

  assert(
    record.proposedAvailableAt ===
      null,
    `AvailableAt already proposed for ${record.observationDate}.`
  );

  assert(
    record.documentedReleaseDateEstablished ===
      false,
    `Documented release unexpectedly established upstream for ${record.observationDate}.`
  );

  assert(
    record.admissionStatus ===
      "NOT_AUTHORIZED",
    `Admission unexpectedly authorized for ${record.observationDate}.`
  );

  assert(
    record.availableAtRepresentsActualPublicationTimestamp ===
      false,
    `AvailableAt must not represent actual publication timestamp on ${record.observationDate}.`
  );

  assert(
    record.actualIntradayReleaseTimeRequired ===
      false,
    `Exact intraday publication time must not be required on ${record.observationDate}.`
  );

  const evidenceRows =
    record.evidenceRows.map(
      (row) => {
        let classification =
          "UNCLASSIFIED";

        if (
          row.candidateNewPublishDate ===
          mapping.initialScheduleDate
        ) {
          classification =
            "INITIAL_SCHEDULE";
        }

        if (
          row.candidateNewPublishDate ===
          mapping.revisedScheduleDate
        ) {
          classification =
            "REVISED_SCHEDULE";
        }

        assert(
          classification !==
            "UNCLASSIFIED",
          `Unclassified schedule row on ${record.observationDate}: ${row.candidateNewPublishDate}`
        );

        return {
          ...row,
          evidenceClassification:
            classification
        };
      }
    );

  /*
   * Methodology 1.1 says a later official schedule
   * revision overrides an earlier schedule when it
   * documents the release date.
   *
   * We therefore classify the revised date as the
   * documented release-date candidate for subsequent
   * explicit human/admission review.
   *
   * This is still NOT admission.
   */
  const documentedReleaseDateCandidate =
    mapping.revisedScheduleDate;

  const conservativeAvailableAtCandidate =
    conservativeAvailableAt(
      documentedReleaseDateCandidate
    );

  return {
    sourceId:
      record.sourceId,

    seriesId:
      record.seriesId,

    marketCode:
      record.marketCode,

    observationDate:
      record.observationDate,

    value:
      record.value,

    originalPublishDates:
      record.originalPublishDates,

    initialScheduleDate:
      mapping.initialScheduleDate,

    revisedScheduleDate:
      mapping.revisedScheduleDate,

    scheduleRevisionEstablished:
      true,

    evidenceRows,

    documentedReleaseEvidence: {
      status:
        "REVISED_OFFICIAL_SCHEDULE_CLASSIFIED",

      documentedReleaseDateCandidate,

      conservativeAvailableAtCandidate,

      availableAtConvention:
        EXPECTED_AVAILABLE_AT_CONVENTION,

      availableAtTimeUtc:
        EXPECTED_AVAILABLE_AT_TIME_UTC,

      actualIntradayReleaseTimeRequired:
        false,

      availableAtRepresentsActualPublicationTimestamp:
        false,

      reason:
        "The later official CFTC schedule revision is classified as the documented release-date candidate under methodology 1.1. The conservative end-of-day UTC timestamp is a research candidate only and is not the actual CFTC publication timestamp."
    },

    selectedReleaseDate:
      null,

    proposedAvailableAt:
      null,

    admissionStatus:
      "NOT_AUTHORIZED",

    classificationStatus:
      "REVISED_SCHEDULE_CLASSIFIED_DOCUMENTED_RELEASE_CANDIDATE_NOT_ADMITTED"
  };
}

async function main() {
  const classificationTimestamp =
    new Date().toISOString();

  const input =
    await readJson(
      INPUT_FILE,
      "CFTC ambiguous release review"
    );

  const methodology =
    await readJson(
      METHODOLOGY_FILE,
      "CFTC methodology decision"
    );

  /*
   * Methodology gate — schema 1.1.
   */
  assert(
    methodology.schemaVersion ===
      "1.1",
    "Unexpected CFTC methodology schema version."
  );

  assert(
    methodology.decisionType ===
      "CFTC_HISTORICAL_AVAILABLE_AT_METHODOLOGY",
    "Unexpected CFTC methodology decision type."
  );

  assert(
    methodology.decisionRecorded ===
      true,
    "CFTC methodology decision is not recorded."
  );

  assert(
    methodology.approved ===
      true,
    "CFTC methodology is not approved."
  );

  assert(
    methodology.admissionAuthorized ===
      false,
    "Historical CFTC admission must remain unauthorized."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.eligibleForAvailableAt ===
      true,
    "Documented CFTC releases must be eligible for AvailableAt."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.releaseDateEvidenceRequired ===
      true,
    "Official release-date evidence must remain required."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.requiredEvidenceType ===
      "OFFICIAL_CFTC",
    "Unexpected required CFTC evidence type."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.availableAtConvention ===
      EXPECTED_AVAILABLE_AT_CONVENTION,
    "Unexpected CFTC AvailableAt convention."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.availableAtTimeUtc ===
      EXPECTED_AVAILABLE_AT_TIME_UTC,
    "Unexpected conservative AvailableAt time."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.actualIntradayReleaseTimeRequired ===
      false,
    "Exact historical intraday publication time must not be required."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.availableAtRepresentsActualPublicationTimestamp ===
      false,
    "Conservative AvailableAt must not be represented as actual publication time."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.documentedExceptionsOverrideNormalSchedule ===
      true,
    "Documented CFTC exceptions must override the normal schedule."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.laterOfficialScheduleRevisionOverridesEarlierSchedule ===
      true,
    "Later official CFTC schedule revisions must override earlier schedules."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.eligibleForAvailableAt ===
      false,
    "Undocumented releases must not be eligible for AvailableAt."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.availableAt ===
      null,
    "Unresolved AvailableAt must remain null."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.observationDatePlusThreeDaysAssumed ===
      false,
    "Observation date + 3 days must not be assumed."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.normalFridayReleaseAssumed ===
      false,
    "Normal Friday release must not be assumed."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.syntheticHistoricalReleaseDateAllowed ===
      false,
    "Synthetic historical release dates remain forbidden."
  );

  /*
   * Input artifact gate.
   */
  assert(
    input.schemaVersion ===
      "1.1",
    "Unexpected ambiguous-review schema."
  );

  assert(
    input.status ===
      EXPECTED_INPUT_STATUS,
    "Unexpected ambiguous-review status."
  );

  assert(
    input.methodology
      ?.decisionSchemaVersion ===
      "1.1",
    "Input was not produced under methodology 1.1."
  );

  assert(
    input.methodology
      ?.admissionAuthorized ===
      false,
    "Input unexpectedly authorizes admission."
  );

  assert(
    input.methodology
      ?.availableAtConvention ===
      EXPECTED_AVAILABLE_AT_CONVENTION,
    "Input uses an unexpected AvailableAt convention."
  );

  assert(
    input.methodology
      ?.availableAtTimeUtc ===
      EXPECTED_AVAILABLE_AT_TIME_UTC,
    "Input uses an unexpected AvailableAt time."
  );

  assert(
    input.methodology
      ?.actualIntradayReleaseTimeRequired ===
      false,
    "Input unexpectedly requires exact intraday publication time."
  );

  assert(
    input.methodology
      ?.availableAtRepresentsActualPublicationTimestamp ===
      false,
    "Input incorrectly represents AvailableAt as actual publication timestamp."
  );

  assert(
    input.summary
      ?.observationsAdmitted ===
      0,
    "Input unexpectedly contains admitted observations."
  );

  assert(
    input.summary
      ?.releaseDatesAutomaticallySelected ===
      0,
    "Input unexpectedly selected release dates."
  );

  assert(
    input.summary
      ?.availableAtAutomaticallyProposed ===
      0,
    "Input unexpectedly proposed AvailableAt values."
  );

  assert(
    Array.isArray(input.records),
    "CFTC ambiguous review records are missing."
  );

  assert(
    input.records.length ===
      7,
    `Expected 7 ambiguous records, found ${input.records.length}.`
  );

  assert(
    Object.keys(
      SCHEDULE_CLASSIFICATION
    ).length ===
      7,
    "Expected exactly seven schedule classifications."
  );

  const seenDates =
    new Set();

  for (const record of input.records) {
    assert(
      record.sourceId ===
        EXPECTED_SOURCE_ID,
      `Unexpected source on ${record.observationDate}.`
    );

    assert(
      record.seriesId ===
        EXPECTED_SERIES_ID,
      `Unexpected series on ${record.observationDate}.`
    );

    assert(
      record.marketCode ===
        EXPECTED_MARKET_CODE,
      `Unexpected market code on ${record.observationDate}.`
    );

    assert(
      isIsoDate(
        record.observationDate
      ),
      `Invalid observation date: ${record.observationDate}`
    );

    assert(
      !seenDates.has(
        record.observationDate
      ),
      `Duplicate observation date: ${record.observationDate}`
    );

    seenDates.add(
      record.observationDate
    );

    assert(
      record.reviewState ===
        "HUMAN_REVIEW_REQUIRED",
      `Unexpected review state on ${record.observationDate}.`
    );

    assert(
      record.availableAtStatus ===
        "NOT_ESTABLISHED",
      `AvailableAt unexpectedly established on ${record.observationDate}.`
    );

    assert(
      record.selectedReleaseDate ===
        null,
      `Input unexpectedly selected release date on ${record.observationDate}.`
    );

    assert(
      record.proposedAvailableAt ===
        null,
      `Input unexpectedly proposed AvailableAt on ${record.observationDate}.`
    );

    assert(
      record.admissionStatus ===
        "NOT_AUTHORIZED",
      `Input unexpectedly authorized admission on ${record.observationDate}.`
    );

    assert(
      Array.isArray(
        record.evidenceRows
      ) &&
        record.evidenceRows.length >=
          2,
      `Evidence rows missing on ${record.observationDate}.`
    );
  }

  /*
   * Classification only.
   */
  const records =
    input.records.map(
      classifyRecord
    );

  const initialScheduleRows =
    records.reduce(
      (count, record) =>
        count +
        record.evidenceRows.filter(
          (row) =>
            row.evidenceClassification ===
            "INITIAL_SCHEDULE"
        ).length,
      0
    );

  const revisedScheduleRows =
    records.reduce(
      (count, record) =>
        count +
        record.evidenceRows.filter(
          (row) =>
            row.evidenceClassification ===
            "REVISED_SCHEDULE"
        ).length,
      0
    );

  const documentedReleaseCandidates =
    records.filter(
      (record) =>
        record.documentedReleaseEvidence
          ?.status ===
        "REVISED_OFFICIAL_SCHEDULE_CLASSIFIED"
    ).length;

  const conservativeAvailableAtCandidates =
    records.filter(
      (record) =>
        typeof record
          .documentedReleaseEvidence
          ?.conservativeAvailableAtCandidate ===
          "string"
    ).length;

  const availableAtAssigned =
    records.filter(
      (record) =>
        record.proposedAvailableAt !==
          null
    ).length;

  const observationsAuthorized =
    records.filter(
      (record) =>
        record.admissionStatus !==
        "NOT_AUTHORIZED"
    ).length;

  assert(
    initialScheduleRows === 7,
    `Expected 7 INITIAL_SCHEDULE rows, found ${initialScheduleRows}.`
  );

  assert(
    revisedScheduleRows === 7,
    `Expected 7 REVISED_SCHEDULE rows, found ${revisedScheduleRows}.`
  );

  assert(
    documentedReleaseCandidates === 7,
    `Expected 7 documented release-date candidates, found ${documentedReleaseCandidates}.`
  );

  assert(
    conservativeAvailableAtCandidates ===
      7,
    `Expected 7 conservative AvailableAt candidates, found ${conservativeAvailableAtCandidates}.`
  );

  assert(
    availableAtAssigned === 0,
    "Schedule classification must not assign final AvailableAt."
  );

  assert(
    observationsAuthorized === 0,
    "Schedule classification must not authorize admission."
  );

  for (const record of records) {
    const releaseDate =
      record.documentedReleaseEvidence
        .documentedReleaseDateCandidate;

    const availableAt =
      record.documentedReleaseEvidence
        .conservativeAvailableAtCandidate;

    assert(
      availableAt ===
        `${releaseDate}T23:59:59.999Z`,
      `Conservative AvailableAt mismatch on ${record.observationDate}.`
    );

    assert(
      record.documentedReleaseEvidence
        .availableAtRepresentsActualPublicationTimestamp ===
        false,
      `AvailableAt incorrectly represented as actual publication time on ${record.observationDate}.`
    );
  }

  const output = {
    schemaVersion:
      "1.1",

    status:
      "CFTC_RELEASE_SCHEDULES_CLASSIFIED_DOCUMENTED_RELEASE_CANDIDATES_NOT_ADMITTED",

    classificationTimestamp,

    sourceArtifact: {
      schemaVersion:
        input.schemaVersion,

      status:
        input.status,

      reviewTimestamp:
        input.reviewTimestamp
    },

    methodology: {
      decisionSchemaVersion:
        methodology.schemaVersion,

      approved:
        true,

      admissionAuthorized:
        false,

      officialReleaseDateEvidenceRequired:
        true,

      availableAtConvention:
        EXPECTED_AVAILABLE_AT_CONVENTION,

      availableAtTimeUtc:
        EXPECTED_AVAILABLE_AT_TIME_UTC,

      actualIntradayReleaseTimeRequired:
        false,

      availableAtRepresentsActualPublicationTimestamp:
        false,

      laterOfficialScheduleRevisionOverridesEarlierSchedule:
        true,

      syntheticHistoricalReleaseDateAllowed:
        false,

      observationDatePlusThreeDaysUsed:
        false,

      normalFridayScheduleUsedAsHistoricalProof:
        false
    },

    targetSeries: {
      sourceId:
        EXPECTED_SOURCE_ID,

      seriesId:
        EXPECTED_SERIES_ID,

      marketCode:
        EXPECTED_MARKET_CODE
    },

    evidenceTaxonomy: {
      INITIAL_SCHEDULE:
        "Earlier official CFTC publication schedule.",

      REVISED_SCHEDULE:
        "Later official CFTC revised publication schedule.",

      DOCUMENTED_RELEASE_DATE_CANDIDATE:
        "Release-date candidate derived from the later official CFTC schedule revision under methodology 1.1. Separate admission authorization is still required.",

      CONSERVATIVE_AVAILABLE_AT_CANDIDATE:
        "Documented release date at 23:59:59.999 UTC. This is a conservative daily research convention and not the actual CFTC publication timestamp."
    },

    summary: {
      recordsClassified:
        records.length,

      initialScheduleRows,

      revisedScheduleRows,

      scheduleRevisionsEstablished:
        records.length,

      documentedReleaseDateCandidates:
        documentedReleaseCandidates,

      conservativeAvailableAtCandidates,

      finalAvailableAtAssigned:
        0,

      observationsAdmitted:
        0
    },

    records,

    interpretation: {
      scheduleRevisionEstablished:
        true,

      laterOfficialScheduleRevisionOverridesEarlierSchedule:
        true,

      revisedScheduleClassifiedAsDocumentedReleaseDateCandidate:
        true,

      exactHistoricalIntradayPublicationTimeRequired:
        false,

      conservativeEndOfDayUtcConventionAppliedToCandidate:
        true,

      conservativeAvailableAtIsActualPublicationTimestamp:
        false,

      candidateIsNotFinalAdmission:
        true,

      historicalAdmissionStillRequiresSeparateAuthorization:
        true,

      observationDatePlusThreeDaysNotUsed:
        true,

      normalFridayScheduleNotUsedAsHistoricalProof:
        true,

      classificationDoesNotEstablishPredictiveValue:
        true,

      classificationDoesNotAuthorizeCalibration:
        true
    },

    safeguards: {
      historicalStoreModified:
        false,

      historicalDatasetModified:
        false,

      pointInTimeDatasetModified:
        false,

      calibrationDatasetModified:
        false,

      calibrationPerformed:
        false,

      modelWeightsModified:
        false,

      thresholdsModified:
        false,

      forecastModelTrained:
        false,

      officialHesiModified:
        false,

      dashboardOfficialHesiModified:
        false
    },

    nextResearchQuestion:
      "Perform a separate explicit human admission review of the seven documented CFTC release-date candidates. Until that authorization exists, the conservative AvailableAt candidates must not enter the historical store."
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
    "CFTC release evidence classification"
  );

  console.log(
    "------------------------------------"
  );

  console.log(
    `Records classified: ${records.length}`
  );

  console.log(
    `INITIAL_SCHEDULE rows: ${initialScheduleRows}`
  );

  console.log(
    `REVISED_SCHEDULE rows: ${revisedScheduleRows}`
  );

  console.log(
    `Documented release-date candidates: ${documentedReleaseCandidates}`
  );

  console.log(
    `Conservative AvailableAt candidates: ${conservativeAvailableAtCandidates}`
  );

  console.log(
    "Final AvailableAt assigned: 0"
  );

  console.log(
    "Historical observations admitted: 0"
  );

  console.log(
    "AvailableAt represents actual publication timestamp: NO"
  );

  console.log(
    "Historical store modified: NO"
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
    "CFTC release evidence classification failed:"
  );

  console.error(error);

  process.exit(1);
});
