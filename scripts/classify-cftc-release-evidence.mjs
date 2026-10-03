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

/*
 * These seven mappings come from the official CFTC
 * post-shutdown publication schedules already preserved
 * in the upstream evidence artifact.
 *
 * IMPORTANT:
 * They classify schedule versions only.
 * They do NOT establish actual first publication.
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
    record.actualReleaseDateEstablished ===
      false,
    `Actual release unexpectedly established for ${record.observationDate}.`
  );

  assert(
    record.admissionStatus ===
      "NOT_AUTHORIZED",
    `Admission unexpectedly authorized for ${record.observationDate}.`
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

    actualReleaseEvidence: {
      status:
        "NOT_ESTABLISHED",

      actualReleaseDate:
        null,

      availableAt:
        null,

      reason:
        "Official evidence establishes successive publication schedules, but this classification step does not establish the actual first historical availability of the report."
    },

    selectedReleaseDate:
      null,

    proposedAvailableAt:
      null,

    admissionStatus:
      "NOT_AUTHORIZED",

    classificationStatus:
      "SCHEDULE_REVISION_CLASSIFIED_ACTUAL_RELEASE_UNRESOLVED"
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
   * Methodology gate.
   */
  assert(
    methodology.schemaVersion ===
      "1.0",
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
      ?.releaseDateEvidenceRequired ===
      true,
    "Actual release-date evidence must remain required."
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
      ?.syntheticHistoricalTimestampAllowed ===
      false,
    "Synthetic historical timestamps remain forbidden."
  );

  /*
   * Input artifact gate.
   */
  assert(
    input.schemaVersion ===
      "1.0",
    "Unexpected ambiguous-review schema."
  );

  assert(
    input.status ===
      EXPECTED_INPUT_STATUS,
    "Unexpected ambiguous-review status."
  );

  assert(
    input.methodology
      ?.admissionAuthorized ===
      false,
    "Input unexpectedly authorizes admission."
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

  const actualReleaseEstablished =
    records.filter(
      (record) =>
        record.actualReleaseEvidence
          .status ===
        "ESTABLISHED"
    ).length;

  const availableAtAssigned =
    records.filter(
      (record) =>
        record.actualReleaseEvidence
          .availableAt !== null
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
    actualReleaseEstablished ===
      0,
    "Schedule classification must not establish actual release dates."
  );

  assert(
    availableAtAssigned === 0,
    "Schedule classification must not assign AvailableAt."
  );

  assert(
    observationsAuthorized === 0,
    "Schedule classification must not authorize admission."
  );

  const output = {
    schemaVersion:
      "1.0",

    status:
      "CFTC_RELEASE_SCHEDULES_CLASSIFIED_ACTUAL_RELEASE_NOT_ESTABLISHED_NOT_ADMITTED",

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
      approved:
        true,

      admissionAuthorized:
        false,

      officialActualReleaseEvidenceRequired:
        true,

      scheduleDateAloneEstablishesAvailableAt:
        false,

      syntheticHistoricalTimestampAllowed:
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

      ACTUAL_RELEASE_EVIDENCE:
        "Independent official evidence sufficient to establish actual historical first availability."
    },

    summary: {
      recordsClassified:
        records.length,

      initialScheduleRows,

      revisedScheduleRows,

      scheduleRevisionsEstablished:
        records.length,

      actualReleaseDatesEstablished:
        0,

      availableAtAssigned:
        0,

      observationsAdmitted:
        0
    },

    records,

    interpretation: {
      scheduleRevisionIsNotActualReleaseProof:
        true,

      revisedScheduleNotAutomaticallySelectedAsAvailableAt:
        true,

      initialScheduleNotAutomaticallySelectedAsAvailableAt:
        true,

      actualReleaseEvidenceStillRequired:
        true,

      unresolvedAvailableAtRemainsNull:
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
      "For each classified schedule revision, determine whether independent official CFTC evidence establishes the actual first historical availability date. Until then, AvailableAt remains null."
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
    "Actual release dates established: 0"
  );

  console.log(
    "AvailableAt assigned: 0"
  );

  console.log(
    "Historical observations admitted: 0"
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
