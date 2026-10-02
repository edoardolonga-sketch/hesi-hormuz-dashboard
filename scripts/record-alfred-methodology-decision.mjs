import { readFile, writeFile } from "node:fs/promises";

const DECISION_GATE_FILE = new URL(
  "../data/brent-alfred-admission-decision.json",
  import.meta.url
);

const HUMAN_DECISION_FILE = new URL(
  "../data/brent-alfred-human-methodology-decision.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/brent-alfred-methodology-decision.json",
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
  const gate = await readJson(
    DECISION_GATE_FILE,
    "brent-alfred-admission-decision.json"
  );

  const humanDecision = await readJson(
    HUMAN_DECISION_FILE,
    "brent-alfred-human-methodology-decision.json"
  );

  /*
   * Expected state:
   *
   * Methodology decision = APPROVED
   * Admission decision   = PENDING
   * Admission authorized = NO
   */
  requireCondition(
    gate.status ===
      "METHODOLOGY_APPROVED_ADMISSION_DECISION_PENDING",
    "Admission decision gate is not in the expected methodology-approved pre-admission state."
  );

  requireCondition(
    gate.consistencyChecks?.passed === true,
    "Admission decision gate consistency checks have not passed."
  );

  requireCondition(
    gate.consistencyChecks
      ?.methodologyDecisionRecorded === true,
    "Gate does not reflect a recorded methodology decision."
  );

  requireCondition(
    gate.consistencyChecks
      ?.methodologyApproved === true,
    "Gate does not reflect methodology approval."
  );

  requireCondition(
    gate.humanDecision
      ?.decisionRecorded === true,
    "Gate does not contain a recorded human decision."
  );

  requireCondition(
    gate.humanDecision
      ?.methodologicalApproval === true,
    "Gate does not contain human methodology approval."
  );

  requireCondition(
    gate.humanDecision
      ?.admissionAuthorized === false,
    "Gate unexpectedly authorizes historical admission."
  );

  requireCondition(
    gate.promotion
      ?.historicalStoreUpdated === false,
    "Historical store was unexpectedly modified."
  );

  requireCondition(
    gate.promotion
      ?.calibrationDatasetUpdated === false,
    "Calibration dataset was unexpectedly modified."
  );

  requireCondition(
    gate.promotion
      ?.officialHesiUpdated === false,
    "Official HESI was unexpectedly modified."
  );

  /*
   * Validate the authoritative human methodology
   * decision independently from the generated gate.
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
    "Human methodology decision has not been approved."
  );

  requireCondition(
    humanDecision.admissionAuthorized === false,
    "Human methodology decision must not authorize historical admission."
  );

  requireCondition(
    humanDecision.historicalStoreModified === false,
    "Human methodology decision unexpectedly modifies the historical store."
  );

  requireCondition(
    humanDecision.calibrationDatasetModified === false,
    "Human methodology decision unexpectedly modifies the calibration dataset."
  );

  requireCondition(
    humanDecision.officialHesiModified === false,
    "Human methodology decision unexpectedly modifies official HESI."
  );

  const decisionRecorded = true;
  const methodologyApproved = true;

  const output = {
    schemaVersion: "1.2",

    status:
      "HUMAN_METHODOLOGY_APPROVED_ADMISSION_DECISION_PENDING",

    createdAt:
      new Date().toISOString(),

    sourceDecisionGate:
      "brent-alfred-admission-decision.json",

    sourceHumanDecision:
      "brent-alfred-human-methodology-decision.json",

    evidenceSnapshot: {
      preparedCandidates:
        gate.candidateSummary?.preparedCandidates ?? null,

      negativeLagCount:
        gate.candidateSummary?.negativeLagCount ?? null,

      overSevenDayLagCount:
        gate.candidateSummary?.overSevenDayLagCount ?? null,

      medianLagCalendarDays:
        gate.candidateSummary?.medianLagCalendarDays ?? null,

      maximumLagCalendarDays:
        gate.candidateSummary?.maximumLagCalendarDays ?? null,

      realtimeStartWednesdayThursdayShare:
        gate.evidenceSummary
          ?.realtimeStartWednesdayThursdayShare ?? null,

      intradayAvailabilityEstablished:
        gate.evidenceSummary
          ?.intradayAvailabilityEstablished ?? false,

      availableAtConvention:
        gate.evidenceSummary
          ?.conservativeAvailableAtConvention ?? null
    },

    methodologicalDecision: {
      decisionRecorded,
      approved:
        methodologyApproved,

      decidedBy:
        humanDecision.decidedBy,

      decidedAt:
        humanDecision.decidedAt,

      rationale:
        humanDecision.rationale,

      acknowledgements:
        humanDecision.acknowledgements
    },

    admissionDecision: {
      decisionRecorded:
        false,

      authorized:
        false,

      authorizedBy:
        null,

      authorizedAt:
        null,

      status:
        "PENDING_EXPLICIT_ADMISSION_DECISION"
    },

    safeguards: {
      automaticAdmission:
        false,

      historicalStoreModified:
        false,

      calibrationDatasetModified:
        false,

      officialHesiModified:
        false,

      backwardAvailableAtAdjustmentAllowed:
        false
    },

    notes: [
      "The human ALFRED AvailableAt methodology decision has been recorded and approved.",
      "The historical admission decision remains separate and pending.",
      "Methodological approval does not authorize historical admission.",
      "No historical observation is promoted by this script.",
      "The 3,939 prepared candidates remain outside the leakage-safe historical store.",
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
    "ALFRED methodology decision record"
  );

  console.log(
    "----------------------------------"
  );

  console.log(
    `Prepared candidates: ${output.evidenceSnapshot.preparedCandidates}`
  );

  console.log(
    `Median lag: ${output.evidenceSnapshot.medianLagCalendarDays} days`
  );

  console.log(
    `Maximum lag: ${output.evidenceSnapshot.maximumLagCalendarDays} days`
  );

  console.log(
    "Human decision recorded: YES"
  );

  console.log(
    "Methodology approved: YES"
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
    "ALFRED methodology decision record failed:"
  );

  console.error(error);

  process.exit(1);
});
