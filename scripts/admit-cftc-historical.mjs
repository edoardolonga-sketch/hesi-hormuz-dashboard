import { readFile, writeFile } from "node:fs/promises";

const DECISION_FILE = new URL(
  "../data/cftc-historical-admission-decision.json",
  import.meta.url
);

const HISTORICAL_FILE = new URL(
  "../data/historical-observations.json",
  import.meta.url
);

const SOURCE_ID = "cftc_cot";

const SERIES_ID =
  "CFTC_WTI_PHYSICAL_MANAGED_MONEY";

const MARKET_CODE = "067651";

const AVAILABLE_AT_CONVENTION =
  "DOCUMENTED_RELEASE_DATE_CONSERVATIVE_END_OF_DAY_UTC";

const AVAILABLE_AT_TIME =
  "23:59:59.999Z";

/*
 * Explicitly authorized historical observations.
 *
 * Values come from the extracted official CFTC
 * WTI-PHYSICAL historical series.
 *
 * Release dates are the later official CFTC
 * revised schedule dates authorized by the
 * separate human admission decision.
 *
 * AvailableAt is a conservative DAILY research
 * convention:
 *
 * documented release date + 23:59:59.999 UTC.
 *
 * It is NOT claimed to be the actual CFTC
 * intraday publication timestamp.
 */
const AUTHORIZED_OBSERVATIONS = [
  {
    observationDate: "2025-11-10",
    value: -11646,
    documentedReleaseDate: "2025-12-10"
  },
  {
    observationDate: "2025-11-18",
    value: -12671,
    documentedReleaseDate: "2025-12-12"
  },
  {
    observationDate: "2025-11-25",
    value: -37010,
    documentedReleaseDate: "2025-12-15"
  },
  {
    observationDate: "2025-12-02",
    value: -34768,
    documentedReleaseDate: "2025-12-17"
  },
  {
    observationDate: "2025-12-09",
    value: 6878,
    documentedReleaseDate: "2025-12-19"
  },
  {
    observationDate: "2025-12-16",
    value: 74,
    documentedReleaseDate: "2025-12-23"
  },
  {
    observationDate: "2025-12-23",
    value: 11360,
    documentedReleaseDate: "2025-12-29"
  }
];

async function readJson(file, label) {
  const raw = await readFile(file, "utf8");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Invalid JSON in ${label}`
    );
  }
}

function requireCondition(
  condition,
  message
) {
  if (!condition) {
    throw new Error(message);
  }
}

function validIsoDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(
      Date.parse(
        `${value}T00:00:00.000Z`
      )
    )
  );
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(
      Date.parse(value)
    )
  );
}

function observationKey(observation) {
  return (
    `${observation.sourceId}|` +
    `${observation.seriesId}|` +
    `${observation.observationDate}`
  );
}

function makeAvailableAt(
  documentedReleaseDate
) {
  requireCondition(
    validIsoDate(
      documentedReleaseDate
    ),
    `Invalid documented release date: ${documentedReleaseDate}`
  );

  const availableAt =
    `${documentedReleaseDate}T${AVAILABLE_AT_TIME}`;

  requireCondition(
    validTimestamp(availableAt),
    `Invalid conservative AvailableAt: ${availableAt}`
  );

  return availableAt;
}

async function main() {
  const decision =
    await readJson(
      DECISION_FILE,
      "cftc-historical-admission-decision.json"
    );

  const historical =
    await readJson(
      HISTORICAL_FILE,
      "historical-observations.json"
    );

  /*
   * HUMAN AUTHORIZATION GATE
   */

  requireCondition(
    decision.schemaVersion === "1.0",
    "Unexpected CFTC admission decision schema."
  );

  requireCondition(
    decision.decisionType ===
      "CFTC_HISTORICAL_ADMISSION_DECISION",
    "Unexpected CFTC admission decision type."
  );

  requireCondition(
    decision.decisionRecorded === true,
    "CFTC admission decision has not been recorded."
  );

  requireCondition(
    decision.approved === true,
    "CFTC historical admission has not been approved."
  );

  requireCondition(
    decision.authorization
      ?.historicalAdmissionAuthorized ===
      true,
    "CFTC historical admission has not been explicitly authorized."
  );

  requireCondition(
    decision.authorization
      ?.authorizedObservationCount ===
      7,
    "Unexpected authorized CFTC observation count."
  );

  requireCondition(
    decision.scope?.sourceId ===
      SOURCE_ID,
    "Unexpected authorized CFTC source."
  );

  requireCondition(
    decision.scope?.seriesId ===
      SERIES_ID,
    "Unexpected authorized CFTC series."
  );

  requireCondition(
    decision.scope?.marketCode ===
      MARKET_CODE,
    "Unexpected authorized CFTC market code."
  );

  /*
   * METHODOLOGY GATE
   */

  requireCondition(
    decision.methodologyRequired
      ?.schemaVersion === "1.1",
    "CFTC methodology 1.1 is required."
  );

  requireCondition(
    decision.methodologyRequired
      ?.availableAtConvention ===
      AVAILABLE_AT_CONVENTION,
    "Unexpected CFTC AvailableAt convention."
  );

  requireCondition(
    decision.methodologyRequired
      ?.availableAtTimeUtc ===
      AVAILABLE_AT_TIME,
    "Unexpected conservative CFTC AvailableAt time."
  );

  requireCondition(
    decision.methodologyRequired
      ?.actualIntradayReleaseTimeRequired ===
      false,
    "Exact historical intraday publication time must not be required."
  );

  requireCondition(
    decision.methodologyRequired
      ?.availableAtRepresentsActualPublicationTimestamp ===
      false,
    "Conservative AvailableAt must not be represented as actual publication time."
  );

  requireCondition(
    decision.methodologyRequired
      ?.laterOfficialScheduleRevisionOverridesEarlierSchedule ===
      true,
    "Later official schedule revision must override earlier schedule."
  );

  /*
   * ANTI-FABRICATION GATES
   */

  requireCondition(
    decision.authorization
      ?.useRevisedOfficialScheduleDate ===
      true,
    "Revised official schedule dates are not authorized."
  );

  requireCondition(
    decision.authorization
      ?.useConservativeEndOfDayUtcAvailableAt ===
      true,
    "Conservative end-of-day AvailableAt is not authorized."
  );

  requireCondition(
    decision.authorization
      ?.syntheticReleaseDatesAllowed ===
      false,
    "Synthetic CFTC release dates must remain forbidden."
  );

  requireCondition(
    decision.authorization
      ?.observationDatePlusThreeDaysAllowed ===
      false,
    "Observation date + 3 days must remain forbidden."
  );

  requireCondition(
    decision.authorization
      ?.normalFridayScheduleAllowedAsHistoricalProof ===
      false,
    "Normal Friday schedule must not be used as historical proof."
  );

  requireCondition(
    decision.authorization
      ?.undocumentedReleaseDatesAllowed ===
      false,
    "Undocumented release dates must remain forbidden."
  );

  /*
   * AUTHORIZED DATE SET
   */

  requireCondition(
    Array.isArray(
      decision.authorizedObservationDates
    ),
    "Authorized CFTC observation-date list is missing."
  );

  requireCondition(
    decision.authorizedObservationDates
      .length === 7,
    "Expected exactly seven authorized CFTC observation dates."
  );

  const authorizedDateSet =
    new Set(
      decision.authorizedObservationDates
    );

  requireCondition(
    authorizedDateSet.size === 7,
    "Authorized CFTC observation dates contain duplicates."
  );

  for (
    const observation
    of AUTHORIZED_OBSERVATIONS
  ) {
    requireCondition(
      authorizedDateSet.has(
        observation.observationDate
      ),
      `Observation date was not explicitly authorized: ${observation.observationDate}`
    );
  }

  for (
    const observationDate
    of authorizedDateSet
  ) {
    requireCondition(
      AUTHORIZED_OBSERVATIONS.some(
        (observation) =>
          observation.observationDate ===
          observationDate
      ),
      `Admission decision contains an unexpected observation date: ${observationDate}`
    );
  }

  /*
   * HISTORICAL STORE
   */

  requireCondition(
    Array.isArray(
      historical.observations
    ),
    "Historical observations array is missing."
  );

  const existingByKey =
    new Map();

  for (
    const observation
    of historical.observations
  ) {
    const key =
      observationKey(observation);

    requireCondition(
      !existingByKey.has(key),
      `Historical store contains duplicate key: ${key}`
    );

    existingByKey.set(
      key,
      observation
    );
  }

  /*
   * PREPARE EXACTLY THE SEVEN
   * AUTHORIZED OBSERVATIONS
   */

  const candidates =
    AUTHORIZED_OBSERVATIONS.map(
      (authorized) => {
        requireCondition(
          validIsoDate(
            authorized.observationDate
          ),
          `Invalid CFTC observation date: ${authorized.observationDate}`
        );

        requireCondition(
          typeof authorized.value ===
            "number" &&
            Number.isFinite(
              authorized.value
            ),
          `Invalid CFTC value on ${authorized.observationDate}`
        );

        requireCondition(
          validIsoDate(
            authorized.documentedReleaseDate
          ),
          `Invalid documented CFTC release date on ${authorized.observationDate}`
        );

        const availableAt =
          makeAvailableAt(
            authorized.documentedReleaseDate
          );

        const observationDateMs =
          Date.parse(
            `${authorized.observationDate}T00:00:00.000Z`
          );

        const availableAtMs =
          Date.parse(availableAt);

        requireCondition(
          availableAtMs >=
            observationDateMs,
          `AvailableAt precedes observationDate: ${authorized.observationDate}`
        );

        return {
          sourceId:
            SOURCE_ID,

          seriesId:
            SERIES_ID,

          marketCode:
            MARKET_CODE,

          observationDate:
            authorized.observationDate,

          availableAt,

          value:
            authorized.value,

          unit:
            "contracts",

          frequency:
            "weekly",

          availableAtEvidence: {
            evidenceType:
              "OFFICIAL_CFTC_REVISED_RELEASE_SCHEDULE",

            documentedReleaseDate:
              authorized.documentedReleaseDate,

            methodologySchemaVersion:
              "1.1",

            availableAtConvention:
              AVAILABLE_AT_CONVENTION,

            actualIntradayReleaseTimeRequired:
              false,

            availableAtRepresentsActualPublicationTimestamp:
              false
          },

          availableAtMethod:
            AVAILABLE_AT_CONVENTION
        };
      }
    );

  requireCondition(
    candidates.length === 7,
    "Expected exactly seven CFTC admission candidates."
  );

  /*
   * IDEMPOTENT ADMISSION
   *
   * - missing key + valid candidate -> admit
   * - existing key + same value -> preserve
   * - existing key + different value -> abort
   *
   * Existing observations and their AvailableAt
   * timestamps are never overwritten.
   */

  const candidateKeys =
    new Set();

  const admitted = [];

  const preservedExisting = [];

  for (
    const candidate
    of candidates
  ) {
    const key =
      observationKey(candidate);

    requireCondition(
      !candidateKeys.has(key),
      `Duplicate CFTC candidate key: ${key}`
    );

    candidateKeys.add(key);

    const existing =
      existingByKey.get(key);

    if (existing) {
      requireCondition(
        existing.value ===
          candidate.value,
        `Existing historical value conflicts with authorized CFTC candidate: ${key}`
      );

      preservedExisting.push({
        key,

        existingValue:
          existing.value,

        candidateValue:
          candidate.value,

        existingAvailableAt:
          existing.availableAt,

        candidateAvailableAt:
          candidate.availableAt
      });

      continue;
    }

    admitted.push(candidate);

    existingByKey.set(
      key,
      candidate
    );
  }

  /*
   * FINAL STORE
   */

  const finalObservations = [
    ...historical.observations,
    ...admitted
  ];

  const finalKeys =
    new Set();

  for (
    const observation
    of finalObservations
  ) {
    const key =
      observationKey(observation);

    requireCondition(
      !finalKeys.has(key),
      `Final historical store would contain duplicate key: ${key}`
    );

    finalKeys.add(key);
  }

  requireCondition(
    finalObservations.length ===
      historical.observations.length +
        admitted.length,
    "Unexpected final historical observation count."
  );

  /*
   * VERIFY ALL SEVEN AUTHORIZED
   * OBSERVATIONS ARE PRESENT
   */

  const finalByKey =
    new Map(
      finalObservations.map(
        (observation) => [
          observationKey(
            observation
          ),
          observation
        ]
      )
    );

  for (
    const candidate
    of candidates
  ) {
    const key =
      observationKey(candidate);

    const finalObservation =
      finalByKey.get(key);

    requireCondition(
      finalObservation,
      `Authorized CFTC observation missing from final historical store: ${key}`
    );

    requireCondition(
      finalObservation.value ===
        candidate.value,
      `Final historical value conflicts with authorized CFTC candidate: ${key}`
    );

    requireCondition(
      validTimestamp(
        finalObservation.availableAt
      ),
      `Final CFTC observation has invalid AvailableAt: ${key}`
    );

    requireCondition(
      Date.parse(
        finalObservation.availableAt
      ) >=
        Date.parse(
          `${finalObservation.observationDate}T00:00:00.000Z`
        ),
      `Final CFTC AvailableAt precedes observationDate: ${key}`
    );
  }

  /*
   * DETERMINISTIC OUTPUT
   */

  finalObservations.sort(
    (a, b) => {
      const dateComparison =
        a.observationDate.localeCompare(
          b.observationDate
        );

      if (
        dateComparison !== 0
      ) {
        return dateComparison;
      }

      const sourceComparison =
        a.sourceId.localeCompare(
          b.sourceId
        );

      if (
        sourceComparison !== 0
      ) {
        return sourceComparison;
      }

      return a.seriesId.localeCompare(
        b.seriesId
      );
    }
  );

  /*
   * WRITE HISTORICAL STORE ONLY
   */

  const output = {
    ...historical,

    status:
      "HISTORICAL_STORE_WITH_APPROVED_CFTC_HISTORY",

    observations:
      finalObservations,

    cftcHistoricalAdmission: {
      decisionRecorded:
        true,

      admissionAuthorized:
        true,

      authorizedObservations:
        candidates.length,

      newlyAdmittedThisRun:
        admitted.length,

      existingCandidatesPreservedThisRun:
        preservedExisting.length,

      allAuthorizedCandidatesPresent:
        true,

      valueConflicts:
        0,

      existingObservationsOverwritten:
        0,

      availableAtConvention:
        AVAILABLE_AT_CONVENTION,

      availableAtTimeUtc:
        AVAILABLE_AT_TIME,

      availableAtRepresentsActualPublicationTimestamp:
        false,

      actualIntradayReleaseTimeRequired:
        false,

      overlapPolicy:
        "Existing observations are preserved when their value matches the explicitly authorized CFTC candidate. No existing observation or AvailableAt timestamp is overwritten.",

      idempotent:
        true,

      calibrationAuthorized:
        false,

      modelWeightChangesAuthorized:
        false,

      thresholdChangesAuthorized:
        false,

      forecastTrainingAuthorized:
        false,

      officialHesiAuthorized:
        false
    }
  };

  await writeFile(
    HISTORICAL_FILE,
    `${JSON.stringify(
      output,
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(
    "CFTC historical admission"
  );

  console.log(
    "-------------------------"
  );

  console.log(
    `Authorized observations: ${candidates.length}`
  );

  console.log(
    `New observations admitted this run: ${admitted.length}`
  );

  console.log(
    `Existing candidate observations preserved: ${preservedExisting.length}`
  );

  console.log(
    "Existing observations overwritten: 0"
  );

  console.log(
    "Value conflicts: 0"
  );

  console.log(
    `Historical store observations: ${finalObservations.length}`
  );

  console.log(
    "All authorized candidates present: YES"
  );

  console.log(
    "Idempotent admission: YES"
  );

  console.log(
    "AvailableAt represents actual publication timestamp: NO"
  );

  console.log(
    "Calibration authorized: NO"
  );

  console.log(
    "Forecast training authorized: NO"
  );

  console.log(
    "Official HESI modified: NO"
  );
}

main().catch((error) => {
  console.error(
    "CFTC historical admission failed:"
  );

  console.error(error);

  process.exit(1);
});
