import axios from "axios";
import { App } from "@tinyhttp/app";
import { logger } from "@tinyhttp/logger";
import ExcelJS from "exceljs";
import LRU from "lru-cache";

const PORT = process.env.PORT || 5000;
const lruCache = new LRU({
  max: 32,
  maxAge: 15 * 60 * 1000, // 15 minutes
});
const client = axios.create();

const app = new App();
app
  .use(logger())
  .get("/", async (req, res) => {
    res.send(HOME_PAGE_HTML);
  })
  .get("/denver-transmission-categories", async (req, res) => {
    const reportWorkbook = await fetchLatestReportWorkbook();
    const countyData = getFilteredCountyData(
      reportWorkbook,
      DENVER_AREA_FIPS_CODES
    );
    res.json(countyData);
  })
  .get("/county-data", async (req, res) => {
    if (!req.query.fips) {
      return res.status(400).json({
        message:
          'Must specificy query param "fips" with comma delimited list of codes',
      });
    }
    const { fips, ...requestedFieldMapping } = req.query;
    const fipsCodes = fips
      .split(",")
      .map((codeString) => parseInt(codeString.trim(), 10));
    // query params other than 'fips' define the county data field mapping to columns in the report
    const countyDataFieldMapping = Object.keys(requestedFieldMapping).length
      ? requestedFieldMapping
      : COUNTY_DATA_FIELD_MAPPING; // defaults to COUNTY_DATA_FIELD_MAPPING
    const reportWorkbook = await fetchLatestReportWorkbook();
    const countyData = getFilteredCountyData(
      reportWorkbook,
      fipsCodes,
      countyDataFieldMapping
    );
    res.json(countyData);
  })
  .listen(PORT);

async function fetchLatestReportWorkbook() {
  const cacheKey = `fetchLatestReportWorkbook`;
  if (lruCache.has(cacheKey)) {
    return lruCache.get(cacheKey);
  }
  const excelAttachmentUrls = await fetchExcelAttachments();
  const fileUrl = getLatestReportUrl(excelAttachmentUrls);
  const reportWorkbook = await downloadWorkbook(fileUrl);
  lruCache.set(cacheKey, reportWorkbook);
  return reportWorkbook;
}

const ARCHIVE_JSON_URL = "https://healthdata.gov/resource/6hii-ae4f.json";

async function fetchExcelAttachments() {
  const response = await client.get(ARCHIVE_JSON_URL);
  const lastReportIndex = response.data.length - 1;
  const lastReport = response.data[lastReportIndex];
  const metaDataPublished = JSON.parse(lastReport.metadata_published);
  const reportAttachments = metaDataPublished.attachments;
  const excelAttachments = reportAttachments.filter(({ filename }) =>
    filename.endsWith(".xlsx")
  );
  const getDownloadUrl = ({ assetId, filename }) => ({
    url: `https://beta.healthdata.gov/api/views/gqxm-d9w9/files/${assetId}?download=true&filename=${filename}`,
    filename,
  });
  return excelAttachments.map(getDownloadUrl);
}

function getLatestReportUrl(attachments) {
  const orderedAttachments = attachments
    .map(({ url, filename }) => {
      const order = parseInt(filename.match(/(\d+).*\.xlsx$/)[1], 10);
      return { url, filename, order };
    })
    .sort((a, b) => b.order - a.order);
  return orderedAttachments[0].url;
}

async function downloadWorkbook(url) {
  const response = await client.request({
    url,
    method: "GET",
    responseType: "stream",
  });
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.read(response.data);
  } catch (error) {
    throw new Error(`Unable to read excel file at ${url}`);
  }
  return workbook;
}

function getFilteredCountyData(
  workbook,
  fipsCodes,
  countyDataFieldMapping = COUNTY_DATA_FIELD_MAPPING
) {
  const reportDate = workbook.getWorksheet("User Notes").getRow(4).getCell("B")
    .value;
  const cacheKey = `getFilteredCountyData:${reportDate}:${getFipsCodesCacheKey(
    fipsCodes
  )}${getFieldMappingCacheKey(countyDataFieldMapping)}`;
  if (lruCache.has(cacheKey)) {
    return lruCache.get(cacheKey);
  }
  const worksheet = workbook.getWorksheet("Counties");
  const columnFipsCode = worksheet.getColumn(
    COUNTY_DATA_FIELD_MAPPING.fipsCode
  );
  const filteredRows = [];
  columnFipsCode.eachCell((cell, rowNumber) => {
    if (fipsCodes.includes(cell.value)) {
      filteredRows.push(rowNumber);
    }
  });
  const countyData = filteredRows.map((rowNumber) => {
    const row = worksheet.getRow(rowNumber);
    return getRowCountyData(countyDataFieldMapping, row);
  });
  const result = {
    reportDate,
    countyData,
  };
  lruCache.set(cacheKey, result);
  return result;
}

function getRowCountyData(countyDataFieldMapping, row) {
  return Object.entries(countyDataFieldMapping).reduce(
    (result, [fieldName, column]) => ({
      ...result,
      [fieldName]: row.getCell(column).value,
    }),
    {}
  );
}

function getFipsCodesCacheKey(fipsCodes) {
  return fipsCodes.sort().join();
}

function getFieldMappingCacheKey(fieldMapping) {
  return Object.entries(fieldMapping)
    .map(([fieldName, column]) => `${fieldName}:${column}`)
    .sort()
    .join();
}

const COUNTY_DATA_FIELD_MAPPING = {
  countyName: "A",
  fipsCode: "B",
  areaOfConcernCategory: "AG",
  communityTransmissionLevelLast7: "AI",
  communityTransmissionLevelPrev7: "AJ",
  casesPer100KLast7Days: "Q",
  casesLast7Days: "P",
  positivityRateLast7Days: "AK",
  fullyVaccinatedPercentPopulation: "CB",
  fullVaccinated12to17PercentPopulation: "CO",
};

const DENVER_AREA_FIPS_CODES = [
  8031,
  8005,
  8001,
  8059,
  8035,
  8123,
  8069,
  8013,
  8014,
  8047,
  8093,
  8019,
];

const HOME_PAGE_HTML = `<!DOCTYPE html>
<html><body>
  <h1>COVID-19 Community Profile Report - powered by HealthData.gov</h1>
  <h2>Filtered by county</h2>
  <form action="/county-data">
    <fieldset>
      <legend>County data by FIPS codes</legend>
      <label for="fips_codes">FIPS Codes (comma separated):</label><br />
		<textarea id="fips_codes" name="fips" cols="80">${DENVER_AREA_FIPS_CODES.join()}</textarea><br />
      <input type="submit" />
    </fieldset>
  </form>
</body></html>`;
