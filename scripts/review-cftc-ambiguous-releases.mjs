import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = new URL(
  "../data/cftc-documented-releases.json",
  import.meta.url
);

const METHODOLOGY_FILE = new URL(
  "../data/cftc-human-methodology-decision.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/cftc-ambiguous-release-review.json",
  import.meta.url
);

const EXPECTED_SOURCE_ID =
  "cftc_cot";

const EXPECTED_SERIES_ID =
  "CFTC_WTI_PHYSICAL_MANAGED_MONEY";

const EXPECTED_MARKET_CODE =
  "067651";

const EXPECTED_INPUT_STATUS =
  "CFTC_STRUCTURED_RELEASE_EVIDENCE_RESOLVED_NOT_ADMITTED";

const EXPECTED_AMBIGUOUS_STATUS =
  "AMBIGUOUS_STRUCTURED_OFFICIAL_EVIDENCE";

const EXPECTED_AVAILABLE_AT_CONVENTION =
  "DOCUMENTED_RELEASE_DATE_CONSERVATIVE_END_OF_DAY_UTC";

const EXPECTED_AVAILABLE_AT_TIME_UTC =
  "23:59:59.999Z";

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

function unique(values) {
  return [...new Set(values)];
}

function sortIsoDates(values) {
  return [...values].sort(
    (a, b) =>
      Date.parse(`${a}T00:00:00.000Z`) -
      Date.parse(`${b}T00:00:00.000Z`)
  );
}

function validateMatchedEvidence(
  record
) {
  assert(
    Array.isArray(
      record.matchedEvidence
    ),
    `matchedEvidence missing on ${record.observationDate}.`
  );

  assert(
    record.matchedEvidence.length >= 2,
    `Ambiguous record ${record.observationDate} must contain at least two evidence rows.`
  );

  for (
    const evidence of
    record.matchedEvidence
  ) {
    assert(
      evidence.reportDate ===
        record.observationDate,
      `Evidence report date mismatch on ${record.observationDate}.`
    );

    assert(
      isIsoDate(
        evidence.originalPublishDate
      ),
      `Invalid original publish date on ${record.observationDate}.`
    );

    assert(
      isIsoDate(
        evidence.newPublishDate
      ),
      `Invalid new publish date on ${record.observationDate}.`
    );

    assert(
      typeof evidence.rowText ===
        "string" &&
      evidence.rowText.length > 0,
      `Missing official row text on ${record.observationDate}.`
    );

    assert(
      Array.isArray(
        evidence.rawCells
      ),
      `Missing raw cells on ${record.observationDate}.`
    );
  }
}

function buildReviewRecord(
  record
) {
  validateMatchedEvidence(
    record
  );

  const releaseDates =
    sortIsoDates(
      unique(
        record.matchedEvidence.map(
          (item) =>
            item.newPublishDate
        )
      )
    );

  assert(
    releaseDates.length >= 2,
    `Record ${record.observationDate} is not genuinely ambiguous.`
  );

  const originalPublishDates =
    sortIsoDates(
      unique(
        record.matchedEvidence.map(
          (item) =>
            item.originalPublishDate
        )
      )
    );

  const evidenceRows =
    record.matchedEvidence.map(
      (item) => ({
        reportDate:
          item.reportDate,

        originalPublishDate:
          item.originalPublishDate,

        candidateNewPublishDate:
          item.newPublishDate,

        rowIndex:
          item.rowIndex,

        rowText:
          item.rowText,

        rawCells:
          item.rawCells
      })
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

    priorResolutionStatus:
      record.resolutionStatus,

    evidenceType:
      record.evidence
        ?.evidenceType ??
      null,

    officialSource:
      record.evidence
        ?.officialSource ??
      null,

    originalPublishDates,

    candidateReleaseDates:
      releaseDates,

    candidateReleaseDateCount:
      releaseDates.length,

    evidenceRows,

    reviewState:
      "HUMAN_REVIEW_REQUIRED",

    documentedReleaseDateEstablished:
      false,

    selectedReleaseDate:
      null,

    proposedAvailableAt:
      null,

    availableAtStatus:
      "NOT_ESTABLISHED",

    availableAtConvention:
      EXPECTED_AVAILABLE_AT_CONVENTION,

    availableAtTimeUtc:
      EXPECTED_AVAILABLE_AT_TIME_UTC,

    availableAtRepresentsActualPublicationTimestamp:
      false,

    actualIntradayReleaseTimeRequired:
      false,

    admissionStatus:
      "NOT_AUTHORIZED",

    automaticResolutionAllowed:
      false,

    automaticSelectionRuleUsed:
      false,

    earliestCandidateAutomaticallySelected:
      false,

    latestCandidateAutomaticallySelected:
      false,

    normalFridayScheduleUsed:
      false,

    observationDatePlusThreeDaysUsed:
      false,

    reviewQuestion:
      "Which candidate release date, if any, is sufficiently supported by official CFTC evidence as the documented historical release date? If established, methodology 1.1 permits only the conservative end-of-day UTC AvailableAt convention; this is not the actual publication timestamp."
  };
}

async function main() {
  const reviewTimestamp =
    new Date().toISOString();

  const input =
    await readJson(
      INPUT_FILE,
      "CFTC documented releases"
    );

  const methodology =
    await readJson(
      METHODOLOGY_FILE,
      "CFTC methodology decision"
    );

  /*
   * Methodology gate — schema 1.1.
   *
   * Exact historical intraday publication time is
   * not required.
   *
   * A sufficiently documented official CFTC release
   * date may receive the conservative daily
   * AvailableAt:
   *
   * YYYY-MM-DDT23:59:59.999Z
   *
   * This is NOT claimed to be the actual publication
   * timestamp and does NOT authorize admission.
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
    "CFTC AvailableAt methodology is not approved."
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
    "Documented CFTC releases must be eligible for AvailableAt under methodology."
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
    "Unexpected conservative CFTC AvailableAt time."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.actualIntradayReleaseTimeRequired ===
      false,
    "Exact historical intraday CFTC publication time must not be required."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.availableAtRepresentsActualPublicationTimestamp ===
      false,
    "Conservative AvailableAt must not be represented as the actual publication timestamp."
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
    "Undocumented CFTC releases must not be eligible for AvailableAt."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.availableAt ===
      null,
    "Undocumented CFTC AvailableAt must remain null."
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
    "Normal Friday publication must not be assumed historically."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.syntheticHistoricalReleaseDateAllowed ===
      false,
    "Synthetic historical release dates must remain forbidden."
  );

  /*
   * Validate structured-resolution artifact.
   */
  assert(
    input.schemaVersion ===
      "2.1",
    "Unexpected CFTC documented-release schema."
  );

  assert(
    input.status ===
      EXPECTED_INPUT_STATUS,
    "Unexpected CFTC documented-release status."
  );

  assert(
    input.methodology
      ?.decisionSchemaVersion ===
      "1.1",
    "Input was not produced under CFTC methodology 1.1."
  );

  assert(
    input.methodology
      ?.admissionAuthorized ===
      false,
    "Input unexpectedly authorizes historical CFTC admission."
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
    "Input uses an unexpected conservative AvailableAt time."
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
    "Input incorrectly represents conservative AvailableAt as actual publication time."
  );

  assert(
    input.summary
      ?.observationsAdmitted ===
      0,
    "Input unexpectedly contains admitted CFTC observations."
  );

  assert(
    Array.isArray(
      input.ambiguousCandidates
    ),
    "ambiguousCandidates missing from input."
  );

  assert(
    input.summary
      ?.ambiguousOfficialEvidence ===
      input.ambiguousCandidates.length,
    "Ambiguous candidate count does not match input summary."
  );

  /*
   * Current research checkpoint:
   * exactly seven ambiguous records.
   *
   * If upstream official evidence changes,
   * fail safely and require explicit review.
   */
  assert(
    input.ambiguousCandidates.length ===
      7,
    `Expected 7 ambiguous CFTC candidates, found ${input.ambiguousCandidates.length}.`
  );

  const seenObservationDates =
    new Set();

  for (
    const record of
    input.ambiguousCandidates
  ) {
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
      !seenObservationDates.has(
        record.observationDate
      ),
      `Duplicate ambiguous observation date: ${record.observationDate}`
    );

    seenObservationDates.add(
      record.observationDate
    );

    assert(
      record.resolutionStatus ===
        EXPECTED_AMBIGUOUS_STATUS,
      `Unexpected resolution status on ${record.observationDate}.`
    );

    assert(
      record.documentedReleaseDate ===
        null,
      `Ambiguous record already has a documented release date: ${record.observationDate}.`
    );

    assert(
      record.proposedAvailableAt ===
        null,
      `Ambiguous record already has proposed AvailableAt: ${record.observationDate}.`
    );

    assert(
      record.admissionStatus ===
        "NOT_AUTHORIZED",
      `Ambiguous record unexpectedly authorized: ${record.observationDate}.`
    );

    assert(
      record.evidence
        ?.documentedReleaseDateEstablished ===
        false,
      `Ambiguous record incorrectly claims established release date: ${record.observationDate}.`
    );

    assert(
      record.evidence
        ?.conservativeAvailableAtConventionApplicable ===
        false,
      `Ambiguous record unexpectedly applies AvailableAt before release-date resolution: ${record.observationDate}.`
    );
  }

  const reviewRecords =
    input.ambiguousCandidates.map(
      buildReviewRecord
    );

  /*
   * Safety invariant:
   * this script prepares evidence for review only.
   *
   * It does NOT:
   * - select a release date,
   * - assign AvailableAt,
   * - authorize historical admission.
   */
  const selectedReleaseDates =
    reviewRecords.filter(
      (record) =>
        record.selectedReleaseDate !==
          null
    );

  const proposedAvailableAt =
    reviewRecords.filter(
      (record) =>
        record.proposedAvailableAt !==
          null
    );

  const authorizedRecords =
    reviewRecords.filter(
      (record) =>
        record.admissionStatus !==
          "NOT_AUTHORIZED"
    );

  assert(
    selectedReleaseDates.length ===
      0,
    "Review script must not automatically select a release date."
  );

  assert(
    proposedAvailableAt.length ===
      0,
    "Review script must not automatically assign AvailableAt."
  );

  assert(
    authorizedRecords.length ===
      0,
    "Review script must not authorize admission."
  );

  const output = {
    schemaVersion:
      "1.1",

    status:
      "CFTC_AMBIGUOUS_RELEASES_PREPARED_FOR_HUMAN_REVIEW_NOT_ADMITTED",

    reviewTimestamp,

    sourceArtifact: {
      schemaVersion:
        input.schemaVersion,

      status:
        input.status,

      analysisTimestamp:
        input.analysisTimestamp
    },

    methodology: {
      decisionSchemaVersion:
        methodology.schemaVersion,

      approved:
        true,

      admissionAuthorized:
        false,

      officialEvidenceRequired:
        true,

      availableAtConvention:
        EXPECTED_AVAILABLE_AT_CONVENTION,

      availableAtTimeUtc:
        EXPECTED_AVAILABLE_AT_TIME_UTC,

      actualIntradayReleaseTimeRequired:
        false,

      availableAtRepresentsActualPublicationTimestamp:
        false,

      documentedExceptionsOverrideNormalSchedule:
        true,

      laterOfficialScheduleRevisionOverridesEarlierSchedule:
        true,

      syntheticHistoricalReleaseDateAllowed:
        false,

      normalFridayScheduleUsedAsHistoricalProof:
        false,

      observationDatePlusThreeDaysUsed:
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

    summary: {
      ambiguousRecordsReviewed:
        reviewRecords.length,

      releaseDatesAutomaticallySelected:
        0,

      availableAtAutomaticallyProposed:
        0,

      observationsAdmitted:
        0,

      humanReviewRequired:
        reviewRecords.length
    },

    records:
      reviewRecords,

    interpretation: {
      ambiguityPreserved:
        true,

      multipleOfficialRowsDoNotAutomaticallyEstablishDocumentedReleaseDate:
        true,

      earliestCandidateNotAutomaticallyPreferred:
        true,

      latestCandidateNotAutomaticallyPreferred:
        true,

      humanOrStrongerOfficialEvidenceRequired:
        true,

      exactHistoricalIntradayPublicationTimeRequired:
        false,

      conservativeEndOfDayUtcAppliesOnlyAfterReleaseDateEstablished:
        true,

      conservativeAvailableAtIsActualPublicationTimestamp:
        false,

      unresolvedAvailableAtRemainsNull:
        true,

      reviewDoesNotEstablishPredictiveValue:
        true,

      reviewDoesNotAuthorizeCalibration:
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
      "For each ambiguous observation, determine which candidate release date, if any, is sufficiently supported by official CFTC evidence. If a documented release date is established, methodology 1.1 permits conservative end-of-day UTC AvailableAt; this convention is not the actual CFTC publication timestamp. Historical admission remains separately unauthorized."
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
    "CFTC ambiguous release review"
  );

  console.log(
    "-----------------------------"
  );

  console.log(
    `Ambiguous records reviewed: ${reviewRecords.length}`
  );

  console.log(
    "Release dates automatically selected: 0"
  );

  console.log(
    "AvailableAt automatically proposed: 0"
  );

  console.log(
    "AvailableAt convention after documented release-date resolution: END-OF-DAY UTC"
  );

  console.log(
    "AvailableAt represents actual publication timestamp: NO"
  );

  console.log(
    "Historical observations admitted: 0"
  );

  console.log(
    `Human review required: ${reviewRecords.length}`
  );

  console.log(
    "Historical store modified: NO"
  );

  console.log(
    "Point-in-time dataset modified: NO"
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
    "CFTC ambiguous release review failed:"
  );

  console.error(error);

  process.exit(1);
});
