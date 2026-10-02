import { readFile, writeFile } from "node:fs/promises";

const STAGING_FILE = new URL(
  "../data/brent-alfred-admission-ready.json",
  import.meta.url
);

const METHODOLOGY_DECISION_FILE = new URL(
  "../data/brent-alfred-methodology-decision.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-availableat-policy-validation.json",
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

function isValidDateOnly(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  );
}

function isExpectedAvailableAt(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/.test(value)
  );
}

async function main() {
  const staging = await readJson(
    STAGING_FILE,
    "brent-alfred-admission-ready.json"
  );

  const methodologyDecision = await readJson(
    METHODOLOGY_DECISION_FILE,
    "brent-alfred-methodology-decision.json"
  );

  const candidates =
    Array.isArray(staging.preparedCandidates)
      ? staging.preparedCandidates
      : [];

  requireCondition(
    candidates.length > 0,
    "No prepared ALFRED candidates found."
  );

  /*
   * The human methodology decision has now been
   * explicitly recorded and approved.
   *
   * This approval concerns only the AvailableAt
   * methodology. It does NOT authorize admission.
   */
  requireCondition(
    methodologyDecision.methodologicalDecision
      ?.decisionRecorded === true,
    "Human methodology decision has not been recorded."
  );

  requireCondition(
    methodologyDecision.methodologicalDecision
      ?.approved === true,
    "ALFRED AvailableAt methodology has not been approved."
  );

  requireCondition(
    methodologyDecision.admissionDecision
      ?.authorized === false,
    "Historical admission has already been authorized."
  );

  requireCondition(
    methodologyDecision.safeguards
      ?.historicalStoreModified === false,
    "Historical store was unexpectedly modified."
  );

  requireCondition(
    methodologyDecision.safeguards
      ?.calibrationDatasetModified === false,
    "Calibration dataset was unexpectedly modified."
  );

  requireCondition(
    methodologyDecision.safeguards
      ?.officialHesiModified === false,
    "Official HESI was unexpectedly modified."
  );

  let validCount = 0;
  let invalidCount = 0;
  let backwardAdjustmentCount = 0;
  let availableAtBeforeObservationCount = 0;

  const failures = [];

  for (const candidate of candidates) {
    const observationDate =
      candidate.observationDate;

    /*
     * Historical ALFRED evidence is date-level.
     * realtimeStart is stored inside availableAtEvidence.
     */
    const realtimeStart =
      candidate.availableAtEvidence?.realtimeStart;

    const availableAt =
      candidate.availableAt;

    const validObservationDate =
      isValidDateOnly(observationDate);

    const validRealtimeStart =
      isValidDateOnly(realtimeStart);

    const validAvailableAt =
      isExpectedAvailableAt(availableAt);

    let expectedAvailableAt = null;

    if (validRealtimeStart) {
      expectedAvailableAt =
        `${realtimeStart}T23:59:59.999Z`;
    }

    /*
     * Approved conservative research convention:
     *
     * ALFRED provides the realtimeStart date but not
     * an established exact intraday publication time.
     *
     * Therefore AvailableAt is assigned to the end
     * of that UTC day.
     */
    const matchesConservativeConvention =
      expectedAvailableAt !== null &&
      availableAt === expectedAvailableAt;

    /*
     * No AvailableAt value may be moved backward
     * relative to the ALFRED date-level evidence.
     */
    const noBackwardAdjustment =
      matchesConservativeConvention;

    const availableAtNotBeforeObservation =
      validObservationDate &&
      validAvailableAt &&
      Date.parse(availableAt) >=
        Date.parse(
          `${observationDate}T00:00:00.000Z`
        );

    if (!noBackwardAdjustment) {
      backwardAdjustmentCount += 1;
    }

    if (!availableAtNotBeforeObservation) {
      availableAtBeforeObservationCount += 1;
    }

    const candidatePassed =
      validObservationDate &&
      validRealtimeStart &&
      validAvailableAt &&
      matchesConservativeConvention &&
      availableAtNotBeforeObservation;

    if (candidatePassed) {
      validCount += 1;
    } else {
      invalidCount += 1;

      failures.push({
        observationDate:
          observationDate ?? null,

        realtimeStart:
          realtimeStart ?? null,

        availableAt:
          availableAt ?? null,

        expectedAvailableAt,

        availableAtMethod:
          candidate.availableAtMethod ?? null,

        checks: {
          validObservationDate,
          validRealtimeStart,
          validAvailableAt,
          matchesConservativeConvention,
          availableAtNotBeforeObservation
        }
      });
    }
  }

  const passed =
    invalidCount === 0 &&
    backwardAdjustmentCount === 0 &&
    availableAtBeforeObservationCount === 0;

  const output = {
    schemaVersion: "1.2",

    status: passed
      ? "AVAILABLE_AT_POLICY_VALIDATED_METHOD_APPROVED_NOT_ADMITTED"
      : "AVAILABLE_AT_POLICY_VALIDATION_FAILED",

    validationTimestamp:
      new Date().toISOString(),

    sourceDataset:
      "brent-alfred-admission-ready.json",

    sourceMethodologyDecision:
      "brent-alfred-methodology-decision.json",

    policy: {
      providerEvidenceLevel:
        "DATE_LEVEL",

      realtimeStartField:
        "availableAtEvidence.realtimeStart",

      intradayPublicationTimeEstablished:
        false,

      conservativeAvailableAtConvention:
        "ALFRED realtimeStart date at 23:59:59.999 UTC",

      backwardAdjustmentAllowed:
        false,

      interpretation:
        "The candidate AvailableAt timestamp is a conservative research convention derived from the ALFRED realtimeStart date stored in availableAtEvidence. It is not represented as a provider-supplied intraday publication timestamp."
    },

    summary: {
      candidatesEvaluated:
        candidates.length,

      validCandidates:
        validCount,

      invalidCandidates:
        invalidCount,

      backwardAdjustmentCount,

      availableAtBeforeObservationCount,

      passed
    },

    humanDecisionState: {
      decisionRecorded:
        methodologyDecision.methodologicalDecision
          ?.decisionRecorded ?? null,

      methodologyApproved:
        methodologyDecision.methodologicalDecision
          ?.approved ?? null,

      admissionAuthorized:
        methodologyDecision.admissionDecision
          ?.authorized ?? null
    },

    failures,

    safeguards: {
      historicalStoreModified:
        false,

      calibrationDatasetModified:
        false,

      officialHesiModified:
        false,

      admissionPerformed:
        false
    },

    notes: [
      "This validation checks the prepared ALFRED candidates only.",
      "The human AvailableAt methodology decision has been recorded and approved.",
      "ALFRED realtimeStart is treated as date-level historical availability evidence.",
      "Exact intraday publication timing is not established.",
      "AvailableAt must equal realtimeStart at 23:59:59.999 UTC.",
      "No AvailableAt timestamp may be shifted backward.",
      "Candidates whose AvailableAt precedes the observation date are rejected.",
      "Methodological approval does not authorize historical admission.",
      "No historical observation is promoted by this script.",
      "No calibration dataset is modified by this script.",
      "Official HESI is not modified by this script."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log(
    "ALFRED AvailableAt policy validation"
  );

  console.log(
    "------------------------------------"
  );

  console.log(
    `Candidates evaluated: ${candidates.length}`
  );

  console.log(
    `Valid candidates: ${validCount}`
  );

  console.log(
    `Invalid candidates: ${invalidCount}`
  );

  console.log(
    `Backward adjustments: ${backwardAdjustmentCount}`
  );

  console.log(
    `AvailableAt before observation: ${availableAtBeforeObservationCount}`
  );

  console.log(
    `Policy validation: ${passed ? "PASS" : "FAIL"}`
  );

  console.log(
    "Human methodology decision recorded: YES"
  );

  console.log(
    "Human methodology approval: YES"
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

  requireCondition(
    passed,
    "ALFRED AvailableAt policy validation failed."
  );
}

main().catch((error) => {
  console.error(
    "ALFRED AvailableAt policy validation failed:"
  );

  console.error(error);

  process.exit(1);
});
