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

  requireCondition(
    gate.status ===
      "METHODOLOGY_DECISION_PENDING_HUMAN_APPROVAL",
    "Admission decision gate is not in the expected pre-admission state."
  );

  requireCondition(
    gate.consistencyChecks?.passed === true,
    "Admission decision gate consistency checks have not passed."
  );

  requireCondition(
    gate.humanDecision?.admissionAuthorized === false,
    "Gate unexpectedly authorizes admission."
  );

  requireCondition(
    gate.promotion?.historicalStoreUpdated === false,
    "Historical store was unexpectedly modified."
  );

  requireCondition(
    gate.promotion?.calibrationDatasetUpdated === false,
    "Calibration dataset was unexpectedly modified."
  );

  requireCondition(
    gate.promotion?.officialHesiUpdated === false,
    "Official HESI was unexpectedly modified."
  );

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

  const decisionRecorded =
    humanDecision.decisionRecorded === true;

  const methodologyApproved =
    decisionRecorded && humanDecision.approved === true;

  let status = "HUMAN_METHODOLOGY_DECISION_NOT_RECORDED";

  if (decisionRecorded && methodologyApproved) {
    status =
      "HUMAN_METHODOLOGY_APPROVED_ADMISSION_NOT_AUTHORIZED";
  } else if (
    decisionRecorded &&
    humanDecision.approved === false
  ) {
    status = "HUMAN_METHODOLOGY_REJECTED";
  }

  const output = {
    schemaVersion: "1.1",

    status,

    createdAt: new Date().toISOString(),

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
      approved: methodologyApproved,
      decidedBy:
        decisionRecorded
          ? humanDecision.decidedBy
          : null,
      decidedAt:
        decisionRecorded
          ? humanDecision.decidedAt
          : null,
      rationale:
        decisionRecorded
          ? humanDecision.rationale
          : null,
      acknowledgements:
        decisionRecorded
          ? humanDecision.acknowledgements
          : null
    },

    admissionDecision: {
      authorized: false,
      authorizedBy: null,
      authorizedAt: null
    },

    safeguards: {
      automaticAdmission: false,
      historicalStoreModified: false,
      calibrationDatasetModified: false,
      officialHesiModified: false,
      backwardAvailableAtAdjustmentAllowed: false
    },

    notes: [
      "This artifact mirrors the separately recorded human methodology decision.",
      "Methodological approval does not authorize historical admission.",
      "No historical observation is promoted by this script.",
      "A separate explicit admission decision is required before any ALFRED candidate can enter the leakage-safe historical store.",
      "No calibration dataset is modified by this script.",
      "Official HESI is not modified by this script."
    ]
  };

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  console.log("ALFRED methodology decision record");
  console.log("----------------------------------");
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
    `Human decision recorded: ${decisionRecorded ? "YES" : "NO"}`
  );
  console.log(
    `Methodology approved: ${methodologyApproved ? "YES" : "NO"}`
  );
  console.log("Admission authorized: NO");
  console.log("Historical store modified: NO");
  console.log("Calibration dataset modified: NO");
  console.log("Official HESI modified: NO");
}

main().catch((error) => {
  console.error(
    "ALFRED methodology decision record failed:"
  );
  console.error(error);
  process.exit(1);
});
