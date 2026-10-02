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

  requireCondition(
    methodologyDecision.methodologicalDecision
      ?.decisionRecorded === false,
    "Human methodology decision state is not pending."
  );

  requireCondition(
    methodologyDecision.methodologicalDecision
      ?.approved === false,
    "Methodology has already been approved."
  );

  requireCondition(
    methodologyDecision.admissionDecision
      ?.authorized === false,
    "Admission has already been authorized."
  );

  let validCount = 0;
  let invalidCount = 0;
  let backwardAdjustmentCount = 0;
  let availableAtBeforeObservationCount = 0;

  const failures = [];

  for (const candidate of candidates) {
    const observationDate =
      candidate.observationDate;

    const realtimeStart =
      candidate.realtimeStart;

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

    const matchesConservativeConvention =
      expectedAvailableAt !== null &&
      availableAt === expectedAvailableAt;

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

    const passed =
      validObservationDate &&
      validRealtimeStart &&
      validAvailableAt &&
      matchesConservativeConvention &&
      availableAtNotBeforeObservation;

    if (passed) {
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
    schemaVersion: "1.0",

    status: passed
      ? "AVAILABLE_AT_POLICY_VALIDATED_NOT_ADMITTED"
      : "AVAILABLE_AT_POLICY_VALIDATION_FAILED",

    validationTimestamp:
      new Date().toISOString(),

    sourceDataset:
      "brent-alfred-admission-ready.json",

    policy: {
      providerEvidenceLevel:
        "DATE_LEVEL",

      intradayPublicationTimeEstablished:
        false,

      conservativeAvailableAtConvention:
        "ALFRED realtimeStart date at 23:59:59.999 UTC",

      backwardAdjustmentAllowed:
        false,

      interpretation:
        "The candidate AvailableAt timestamp is a conservative research convention derived from the ALFRED realtimeStart date. It is not represented as a provider-supplied intraday publication timestamp."
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
      "It does not establish an exact intraday publication time.",
      "It requires AvailableAt to equal realtimeStart at 23:59:59.999 UTC.",
      "It rejects any candidate whose AvailableAt precedes its observation date.",
      "It does not move any AvailableAt timestamp backward.",
      "Passing this validation does not constitute human methodological approval.",
      "Passing this validation does not authorize admission.",
      "No historical observation is promoted by this script."
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
    "Human methodology approval: NO"
  );

  console.log(
    "Admission authorized: NO"
  );

  console.log(
    "Historical store modified: NO"
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
