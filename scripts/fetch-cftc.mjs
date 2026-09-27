const MARKET_CODE = "067651";

const CFTC_URL =
  "https://www.cftc.gov/dea/futures/petroleum_sf.htm";

function cleanText(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const response = await fetch(CFTC_URL, {
    headers: {
      "User-Agent": "hesi-hormuz-dashboard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(
      `CFTC request failed: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();
  const text = cleanText(html);

  console.log("CFTC DIAGNOSTIC");
  console.log("----------------");
  console.log(`HTTP status: ${response.status}`);
  console.log(`HTML length: ${html.length}`);
  console.log(`Text length: ${text.length}`);

  const codeIndex = text.indexOf(MARKET_CODE);

  console.log(`Market code: ${MARKET_CODE}`);
  console.log(`Market code index: ${codeIndex}`);

  if (codeIndex === -1) {
    console.log("");
    console.log("MARKET CODE NOT FOUND");
    console.log("");
    console.log(
      "First 3000 characters received from CFTC:"
    );
    console.log(text.slice(0, 3000));

    throw new Error(
      `CFTC market code ${MARKET_CODE} not found.`
    );
  }

  const start = Math.max(0, codeIndex - 2000);
  const end = Math.min(
    text.length,
    codeIndex + 5000
  );

  console.log("");
  console.log("===== CFTC WTI RAW SECTION START =====");
  console.log(text.slice(start, end));
  console.log("===== CFTC WTI RAW SECTION END =====");
  console.log("");

  console.log(
    "Diagnostic completed successfully."
  );
}

main().catch((error) => {
  console.error("CFTC diagnostic failed:");
  console.error(error);
  process.exit(1);
});
