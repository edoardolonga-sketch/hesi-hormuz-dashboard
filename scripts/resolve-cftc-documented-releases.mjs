import { readFile, writeFile } from "node:fs/promises";

const INPUT_FILE = new URL(
  "../data/cftc-historical-release-evidence.json",
  import.meta.url
);

const METHODOLOGY_FILE = new URL(
  "../data/cftc-human-methodology-decision.json",
  import.meta.url
);

const OUTPUT_FILE = new URL(
  "../data/cftc-documented-releases.json",
  import.meta.url
);

const SPECIAL_ANNOUNCEMENTS_URL =
  "https://www.cftc.gov/MarketReports/CommitmentsofTraders/HistoricalSpecialAnnouncements/index.htm";

const EXPECTED_SOURCE_ID =
  "cftc_cot";

const EXPECTED_SERIES_ID =
  "CFTC_WTI_PHYSICAL_MANAGED_MONEY";

const EXPECTED_MARKET_CODE =
  "067651";

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

async function fetchOfficialPage(url) {
  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "hesi-hormuz-dashboard/1.0"
      }
    });

  if (!response.ok) {
    throw new Error(
      `CFTC request failed: ${response.status} ${response.statusText}`
    );
  }

  const html =
    await response.text();

  assert(
    html.length > 0,
    "CFTC special announcements page returned empty content."
  );

  return html;
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-");
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return stripHtml(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function isoDateFromParts(
  year,
  month,
  day
) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  const date =
    new Date(
      Date.UTC(
        y,
        m - 1,
        d
      )
    );

  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() + 1 !== m ||
    date.getUTCDate() !== d
  ) {
    return null;
  }

  return [
    String(y).padStart(4, "0"),
    String(m).padStart(2, "0"),
    String(d).padStart(2, "0")
  ].join("-");
}

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,

  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function parseDateCell(value) {
  const text =
    normalizeText(value)
      .replace(/\./g, "");

  if (!text) {
    return null;
  }

  /*
   * ISO:
   * 2025-09-30
   */
  let match =
    text.match(
      /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/
    );

  if (match) {
    return isoDateFromParts(
      match[1],
      match[2],
      match[3]
    );
  }

  /*
   * Numeric US:
   * 9/30/2025
   * 09/30/2025
   */
  match =
    text.match(
      /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/
    );

  if (match) {
    return isoDateFromParts(
      match[3],
      match[1],
      match[2]
    );
  }

  /*
   * September 30, 2025
   * Sep 30, 2025
   */
  match =
    text.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(20\d{2})\b/i
    );

  if (match) {
    const month =
      MONTHS[
        match[1].toLowerCase()
      ];

    return isoDateFromParts(
      match[3],
      month,
      match[2]
    );
  }

  /*
   * 30 September 2025
   * 30 Sep 2025
   */
  match =
    text.match(
      /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec),?\s+(20\d{2})\b/i
    );

  if (match) {
    const month =
      MONTHS[
        match[2].toLowerCase()
      ];

    return isoDateFromParts(
      match[3],
      month,
      match[1]
    );
  }

  return null;
}

function extractTableRows(html) {
  const rows = [];

  const rowRegex =
    /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  let rowMatch;

  while (
    (rowMatch =
      rowRegex.exec(html)) !== null
  ) {
    const rowHtml =
      rowMatch[1];

    const cells = [];

    const cellRegex =
      /<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;

    let cellMatch;

    while (
      (cellMatch =
        cellRegex.exec(rowHtml)) !==
      null
    ) {
      cells.push(
        normalizeText(
          cellMatch[2]
        )
      );
    }

    if (cells.length > 0) {
      rows.push({
        cells,
        rowText:
          cells.join(" | ")
      });
    }
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isReportDateHeader(value) {
  const header =
    normalizeHeader(value);

  return (
    header.includes(
      "cot report date"
    ) ||
    header.includes(
      "report date"
    )
  );
}

function isOriginalPublishHeader(
  value
) {
  const header =
    normalizeHeader(value);

  return (
    header.includes(
      "original publish date"
    ) ||
    header.includes(
      "original publication date"
    ) ||
    header.includes(
      "original release date"
    )
  );
}

function isNewPublishHeader(value) {
  const header =
    normalizeHeader(value);

  return (
    header.includes(
      "new publish date"
    ) ||
    header.includes(
      "new publication date"
    ) ||
    header.includes(
      "new release date"
    ) ||
    header.includes(
      "actual publish date"
    ) ||
    header.includes(
      "actual publication date"
    ) ||
    header.includes(
      "actual release date"
    )
  );
}

function findHeaderLayout(rows) {
  for (
    let index = 0;
    index < rows.length;
    index += 1
  ) {
    const cells =
      rows[index].cells;

    const reportDateIndex =
      cells.findIndex(
        isReportDateHeader
      );

    const originalPublishDateIndex =
      cells.findIndex(
        isOriginalPublishHeader
      );

    const newPublishDateIndex =
      cells.findIndex(
        isNewPublishHeader
      );

    if (
      reportDateIndex !== -1 &&
      newPublishDateIndex !== -1
    ) {
      return {
        headerRowIndex:
          index,

        headerCells:
          cells,

        reportDateIndex,

        originalPublishDateIndex,

        newPublishDateIndex
      };
    }
  }

  return null;
}

function buildStructuredReleaseMap(
  rows,
  layout
) {
  const map =
    new Map();

  const parsedRows = [];

  for (
    let index =
      layout.headerRowIndex + 1;
    index < rows.length;
    index += 1
  ) {
    const row =
      rows[index];

    const maxRequiredIndex =
      Math.max(
        layout.reportDateIndex,
        layout.newPublishDateIndex,
        layout.originalPublishDateIndex
      );

    if (
      row.cells.length <=
      Math.max(
        layout.reportDateIndex,
        layout.newPublishDateIndex
      )
    ) {
      continue;
    }

    const reportDate =
      parseDateCell(
        row.cells[
          layout.reportDateIndex
        ]
      );

    const newPublishDate =
      parseDateCell(
        row.cells[
          layout.newPublishDateIndex
        ]
      );

    let originalPublishDate =
      null;

    if (
      layout.originalPublishDateIndex !==
        -1 &&
      row.cells.length >
        layout.originalPublishDateIndex
    ) {
      originalPublishDate =
        parseDateCell(
          row.cells[
            layout.originalPublishDateIndex
          ]
        );
    }

    /*
     * Once we are beyond the relevant table,
     * arbitrary rows may follow. We simply ignore
     * rows that do not contain both required dates.
     */
    if (
      !reportDate ||
      !newPublishDate
    ) {
      continue;
    }

    const parsed = {
      reportDate,
      originalPublishDate,
      newPublishDate,

      rowIndex:
        index,

      rowText:
        row.rowText,

      rawCells:
        row.cells
    };

    parsedRows.push(parsed);

    if (!map.has(reportDate)) {
      map.set(
        reportDate,
        []
      );
    }

    map
      .get(reportDate)
      .push(parsed);
  }

  return {
    map,
    parsedRows
  };
}

/*
 * Convert 15:30 America/New_York to UTC
 * using the historical timezone rules supplied
 * by Node/Intl. We deliberately do not hardcode
 * EST or EDT.
 */
function localNewYork1530ToUtc(
  isoDate
) {
  assert(
    isIsoDate(isoDate),
    `Invalid release date: ${isoDate}`
  );

  const [
    year,
    month,
    day
  ] =
    isoDate
      .split("-")
      .map(Number);

  let utcMillis =
    Date.UTC(
      year,
      month - 1,
      day,
      15,
      30,
      0,
      0
    );

  const formatter =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/New_York",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hourCycle:
          "h23"
      }
    );

  for (
    let i = 0;
    i < 3;
    i += 1
  ) {
    const parts =
      formatter.formatToParts(
        new Date(utcMillis)
      );

    const map =
      Object.fromEntries(
        parts.map(
          ({ type, value }) =>
            [type, value]
        )
      );

    const representedLocalAsUtc =
      Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        Number(map.day),
        Number(map.hour),
        Number(map.minute),
        Number(map.second)
      );

    const desiredLocalAsUtc =
      Date.UTC(
        year,
        month - 1,
        day,
        15,
        30,
        0
      );

    utcMillis +=
      desiredLocalAsUtc -
      representedLocalAsUtc;
  }

  const finalDate =
    new Date(utcMillis);

  const verification =
    Object.fromEntries(
      formatter
        .formatToParts(finalDate)
        .map(
          ({ type, value }) =>
            [type, value]
        )
    );

  assert(
    Number(
      verification.year
    ) === year &&
      Number(
        verification.month
      ) === month &&
      Number(
        verification.day
      ) === day &&
      Number(
        verification.hour
      ) === 15 &&
      Number(
        verification.minute
      ) === 30,
    `Timezone conversion verification failed for ${isoDate}.`
  );

  return finalDate.toISOString();
}

function resolveCandidate(
  record,
  structuredReleaseMap
) {
  assert(
    record.evidenceStatus ===
      "OFFICIAL_PAGE_DATE_MENTION_FOUND",
    `Record ${record.observationDate} is not an official-page candidate.`
  );

  const matches =
    structuredReleaseMap.get(
      record.observationDate
    ) ?? [];

  /*
   * No structured row:
   * leave AvailableAt unresolved.
   */
  if (matches.length === 0) {
    return {
      ...record,

      resolutionStatus:
        "UNRESOLVED_NO_STRUCTURED_RELEASE_ROW",

      documentedReleaseDate:
        null,

      proposedAvailableAt:
        null,

      evidence: {
        evidenceType:
          "OFFICIAL_CFTC_TABLE",

        officialSource:
          SPECIAL_ANNOUNCEMENTS_URL,

        structuredRowsFound:
          0,

        actualReleaseDateEstablished:
          false,

        requiresHumanReviewBeforeAdmission:
          true
      },

      matchedEvidence:
        [],

      admissionStatus:
        "NOT_AUTHORIZED"
    };
  }

  const uniqueNewPublishDates =
    [
      ...new Set(
        matches.map(
          (match) =>
            match.newPublishDate
        )
      )
    ];

  /*
   * Multiple different release dates for the same
   * report date are not resolved automatically.
   */
  if (
    uniqueNewPublishDates.length !== 1
  ) {
    return {
      ...record,

      resolutionStatus:
        "AMBIGUOUS_STRUCTURED_OFFICIAL_EVIDENCE",

      documentedReleaseDate:
        null,

      proposedAvailableAt:
        null,

      evidence: {
        evidenceType:
          "OFFICIAL_CFTC_TABLE",

        officialSource:
          SPECIAL_ANNOUNCEMENTS_URL,

        structuredRowsFound:
          matches.length,

        uniqueNewPublishDates,

        actualReleaseDateEstablished:
          false,

        requiresHumanReviewBeforeAdmission:
          true
      },

      matchedEvidence:
        matches,

      admissionStatus:
        "NOT_AUTHORIZED"
    };
  }

  const releaseDate =
    uniqueNewPublishDates[0];

  /*
   * The official table supplies the release date.
   * Our already-approved methodology supplies the
   * standard 15:30 America/New_York publication time.
   */
  const proposedAvailableAt =
    localNewYork1530ToUtc(
      releaseDate
    );

  return {
    ...record,

    resolutionStatus:
      "DOCUMENTED_RELEASE_CANDIDATE",

    documentedReleaseDate:
      releaseDate,

    proposedAvailableAt,

    publicationTimeLocal:
      "15:30:00",

    publicationTimezone:
      "America/New_York",

    evidence: {
      evidenceType:
        "OFFICIAL_CFTC_TABLE",

      officialSource:
        SPECIAL_ANNOUNCEMENTS_URL,

      structuredRowsFound:
        matches.length,

      uniqueNewPublishDates,

      actualReleaseDateEstablished:
        true,

      publicationTimeBasis:
        "APPROVED_CFTC_AVAILABLE_AT_METHODOLOGY",

      requiresHumanReviewBeforeAdmission:
        true
    },

    matchedEvidence:
      matches,

    admissionStatus:
      "NOT_AUTHORIZED"
  };
}

async function main() {
  const analysisTimestamp =
    new Date().toISOString();

  const input =
    await readJson(
      INPUT_FILE,
      "CFTC historical release evidence"
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
    "CFTC methodology decision has not been recorded."
  );

  assert(
    methodology.approved === true,
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
      ?.releaseDateEvidenceRequired ===
      true,
    "Official release-date evidence is not required by methodology."
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
      ?.publicationTimeLocal ===
      "15:30:00",
    "Unexpected approved CFTC publication time."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.publicationTimezone ===
      "America/New_York",
    "Unexpected approved CFTC publication timezone."
  );

  assert(
    methodology.policy
      ?.documentedRelease
      ?.utcConversion ===
      "TIMEZONE_AWARE",
    "CFTC methodology does not require timezone-aware UTC conversion."
  );

  assert(
    methodology.policy
      ?.undocumentedRelease
      ?.availableAt === null,
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
      ?.syntheticHistoricalTimestampAllowed ===
      false,
    "Synthetic historical CFTC timestamps must remain forbidden."
  );

  /*
   * Validate first-pass evidence artifact.
   */
  assert(
    input.schemaVersion ===
      "1.0",
    "Unexpected CFTC release-evidence schema."
  );

  assert(
    input.status ===
      "CFTC_HISTORICAL_RELEASE_EVIDENCE_ANALYZED_NOT_ADMITTED",
    "Unexpected CFTC release-evidence status."
  );

  assert(
    Array.isArray(input.records),
    "CFTC release-evidence records are missing."
  );

  assert(
    input.summary
      ?.observationsAnalyzed ===
      input.records.length,
    "CFTC observation count does not match evidence records."
  );

  assert(
    input.summary
      ?.observationsAdmitted ===
      0,
    "Input artifact unexpectedly contains admitted observations."
  );

  /*
   * Revalidate every historical record before
   * considering official evidence.
   */
  const seenDates =
    new Set();

  for (
    const record of input.records
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
      !seenDates.has(
        record.observationDate
      ),
      `Duplicate CFTC observation date: ${record.observationDate}`
    );

    seenDates.add(
      record.observationDate
    );

    assert(
      record.existingAvailableAt ===
        null,
      `Historical AvailableAt already exists on ${record.observationDate}.`
    );

    assert(
      record.admissionStatus ===
        "NOT_AUTHORIZED",
      `Unexpected admission status on ${record.observationDate}.`
    );
  }

  /*
   * We continue to deep-review only records already
   * identified by the first-pass evidence analysis.
   * The remaining records are deliberately untouched.
   */
  const candidates =
    input.records.filter(
      (record) =>
        record.evidenceStatus ===
        "OFFICIAL_PAGE_DATE_MENTION_FOUND"
    );

  const untouchedUnresolved =
    input.records.filter(
      (record) =>
        record.evidenceStatus ===
        "UNRESOLVED"
    );

  assert(
    candidates.length ===
      input.summary
        .officialPageDateMentions,
    "Candidate count does not match prior evidence artifact."
  );

  assert(
    untouchedUnresolved.length ===
      input.summary.unresolved,
    "Unresolved count does not match prior evidence artifact."
  );

  /*
   * Fetch official CFTC evidence.
   */
  const officialHtml =
    await fetchOfficialPage(
      SPECIAL_ANNOUNCEMENTS_URL
    );

  const pageText =
    normalizeText(
      officialHtml
    );

  assert(
    pageText
      .toLowerCase()
      .includes(
        "commitments of traders"
      ),
    "Official CFTC page identity check failed."
  );

  /*
   * Parse the HTML table structurally.
   */
  const tableRows =
    extractTableRows(
      officialHtml
    );

  assert(
    tableRows.length > 0,
    "No HTML table rows found on official CFTC page."
  );

  const headerLayout =
    findHeaderLayout(
      tableRows
    );

  assert(
    headerLayout !== null,
    "Could not identify CFTC table headers for report date and new publish date."
  );

  const {
    map:
      structuredReleaseMap,

    parsedRows:
      structuredReleaseRows
  } =
    buildStructuredReleaseMap(
      tableRows,
      headerLayout
    );

  assert(
    structuredReleaseRows.length >
      0,
    "CFTC release table was found but no structured release rows could be parsed."
  );

  /*
   * Resolve only the prior evidence candidates.
   */
  const resolvedCandidates =
    candidates.map(
      (record) =>
        resolveCandidate(
          record,
          structuredReleaseMap
        )
    );

  const documentedCandidates =
    resolvedCandidates.filter(
      (record) =>
        record.resolutionStatus ===
        "DOCUMENTED_RELEASE_CANDIDATE"
    );

  const ambiguousCandidates =
    resolvedCandidates.filter(
      (record) =>
        record.resolutionStatus ===
        "AMBIGUOUS_STRUCTURED_OFFICIAL_EVIDENCE"
    );

  const unresolvedCandidates =
    resolvedCandidates.filter(
      (record) =>
        record.resolutionStatus ===
        "UNRESOLVED_NO_STRUCTURED_RELEASE_ROW"
    );

  /*
   * Safety validation for documented candidates.
   */
  for (
    const record of
    documentedCandidates
  ) {
    assert(
      isIsoDate(
        record.documentedReleaseDate
      ),
      `Invalid documented release date on ${record.observationDate}.`
    );

    assert(
      typeof record.proposedAvailableAt ===
        "string" &&
        Number.isFinite(
          Date.parse(
            record.proposedAvailableAt
          )
        ),
      `Invalid proposed AvailableAt on ${record.observationDate}.`
    );

    assert(
      Date.parse(
        record.proposedAvailableAt
      ) >
        Date.parse(
          `${record.observationDate}T00:00:00.000Z`
        ),
      `Proposed AvailableAt does not follow observation date on ${record.observationDate}.`
    );

    assert(
      record.evidence
        ?.evidenceType ===
        "OFFICIAL_CFTC_TABLE",
      `Unexpected evidence type on ${record.observationDate}.`
    );

    assert(
      record.evidence
        ?.actualReleaseDateEstablished ===
        true,
      `Release date not established on ${record.observationDate}.`
    );

    assert(
      record.admissionStatus ===
        "NOT_AUTHORIZED",
      `Documented candidate unexpectedly authorized for admission: ${record.observationDate}.`
    );
  }

  /*
   * Records that had no first-pass official evidence
   * remain unresolved and are not reinterpreted.
   */
  const untouchedRecords =
    untouchedUnresolved.map(
      (record) => ({
        ...record,

        resolutionStatus:
          "UNRESOLVED_NOT_REINTERPRETED",

        documentedReleaseDate:
          null,

        proposedAvailableAt:
          null,

        admissionStatus:
          "NOT_AUTHORIZED"
      })
    );

  const proposedAvailableAtCount =
    documentedCandidates.filter(
      (record) =>
        typeof record.proposedAvailableAt ===
        "string"
    ).length;

  assert(
    proposedAvailableAtCount ===
      documentedCandidates.length,
    "Not every documented release candidate has exactly one proposed AvailableAt."
  );

  /*
   * Important:
   * proposed AvailableAt values are evidence-derived
   * candidates only. Nothing is admitted here.
   */
  const output = {
    schemaVersion:
      "2.0",

    status:
      "CFTC_STRUCTURED_RELEASE_EVIDENCE_RESOLVED_NOT_ADMITTED",

    analysisTimestamp,

    methodology: {
      approved:
        true,

      admissionAuthorized:
        false,

      officialReleaseEvidenceRequired:
        true,

      publicationTimeLocal:
        "15:30:00",

      publicationTimezone:
        "America/New_York",

      timezoneAwareUtcConversion:
        true,

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

    officialEvidenceSource: {
      url:
        SPECIAL_ANNOUNCEMENTS_URL,

      evidenceType:
        "OFFICIAL_CFTC_TABLE",

      retrieved:
        true,

      byteLength:
        Buffer.byteLength(
          officialHtml,
          "utf8"
        ),

      tableRowsFound:
        tableRows.length,

      structuredReleaseRowsParsed:
        structuredReleaseRows.length,

      detectedHeaders:
        headerLayout.headerCells,

      reportDateColumnIndex:
        headerLayout.reportDateIndex,

      originalPublishDateColumnIndex:
        headerLayout.originalPublishDateIndex,

      newPublishDateColumnIndex:
        headerLayout.newPublishDateIndex
    },

    summary: {
      totalHistoricalObservations:
        input.records.length,

      candidatesDeepReviewed:
        resolvedCandidates.length,

      documentedReleaseCandidates:
        documentedCandidates.length,

      ambiguousOfficialEvidence:
        ambiguousCandidates.length,

      unresolvedAfterStructuredReview:
        unresolvedCandidates.length,

      priorUnresolvedLeftUntouched:
        untouchedRecords.length,

      availableAtCandidatesProposed:
        proposedAvailableAtCount,

      observationsAdmitted:
        0
    },

    documentedCandidates,

    ambiguousCandidates,

    unresolvedCandidates,

    priorUnresolvedRecords:
      untouchedRecords,

    structuredOfficialReleaseRows:
      structuredReleaseRows,

    interpretation: {
      structuredTableEvidenceUsed:
        true,

      documentedReleaseCandidateIsNotAdmission:
        true,

      humanReviewStillRequired:
        true,

      officialEvidenceRequired:
        true,

      publicationTimeComesFromApprovedMethodology:
        true,

      normalFridayScheduleNotUsedAsHistoricalProof:
        true,

      observationDatePlusThreeDaysNotUsed:
        true,

      unresolvedRecordsRetainNullAvailableAt:
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
      "Human-review each structured documented release candidate against the official CFTC table before authorizing any historical CFTC admission."
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
    "CFTC structured release evidence resolution"
  );

  console.log(
    "-------------------------------------------"
  );

  console.log(
    `Historical observations: ${input.records.length}`
  );

  console.log(
    `Prior evidence candidates reviewed: ${resolvedCandidates.length}`
  );

  console.log(
    `Official structured release rows parsed: ${structuredReleaseRows.length}`
  );

  console.log(
    `Documented release candidates: ${documentedCandidates.length}`
  );

  console.log(
    `Ambiguous official evidence: ${ambiguousCandidates.length}`
  );

  console.log(
    `Unresolved after structured review: ${unresolvedCandidates.length}`
  );

  console.log(
    `Prior unresolved left untouched: ${untouchedRecords.length}`
  );

  console.log(
    `AvailableAt candidates proposed: ${proposedAvailableAtCount}`
  );

  console.log(
    "Historical observations admitted: 0"
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
    "CFTC structured release evidence resolution failed:"
  );

  console.error(error);

  process.exit(1);
});
