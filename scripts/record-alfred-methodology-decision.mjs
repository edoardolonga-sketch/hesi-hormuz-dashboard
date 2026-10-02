import { readFile, writeFile } from "node:fs/promises";

const DECISION_GATE_FILE = new URL(
  "../data/brent-alfred-admission-decision.json",
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

  requireCondition(
    gate.status ===
      "METHODOLOGY_DECISION_PENDING_HUMAN_APPROVAL",
    "Admission decision gate is not awaiting human approval."
  );

  requireCondition(
    gate.consistencyChecks?.passed === true,
    "Admission decision gate consistency checks have not passed."
  );

  requireCondition(
    gate.humanDecision?.methodologicalApproval === false,
    "Gate already contains methodological approval."
  );

  requireCondition(
    gate.humanDecision?.admissionAuthorized === false,
    "Gate already authorizes admission."
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

  const output = {
    schemaVersion: "1.0",

    status:
      "HUMAN_METHODOLOGY_DECISION_NOT_RECORDED",

    createdAt:
      new Date().toISOString(),

    sourceDecisionGate:
      "brent-alfred-admission-decision.json",

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
      decisionRecorded: false,
      approved: false,
      decidedBy: null,
      decidedAt: null,
      rationale: null
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

    requiredBeforeApproval: [
      "Explicit human review of the ALFRED date-level availability methodology.",
      "Explicit acceptance or rejection of the conservative end-of-day UTC AvailableAt convention.",
      "Explicit acknowledgement that exact intraday publication timing is not established.",
      "Explicit acknowledgement that long calendar lags are retained rather than shifted backward.",
      "Explicit confirmation that the previously identified negative-lag anomaly remains excluded.",
      "Separate explicit authorization before any candidate is admitted into the leakage-safe historical store."
    ],

    notes: [
      "This artifact records the state before a human methodological decision.",
      "Creating this artifact does not constitute methodological approval.",
      "Creating this artifact does not authorize historical admission.",
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
  console.log("Human decision recorded: NO");
  console.log("Methodology approved: NO");
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
