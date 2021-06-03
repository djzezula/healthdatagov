import axios from "axios";
import { App } from "@tinyhttp/app";
import { logger } from "@tinyhttp/logger";

const PORT = process.env.PORT || 5000;

const app = new App();
app
  .use(logger())
  .get("/", async (req, res) => {
    const excelAttachmentUrls = await fetchExcelAttachmentUrls();
    const downloadLinks = excelAttachmentUrls.map(
      (url) => `<a href="${url}">${url}</a>`
    );
    res.send(downloadLinks.join("<br />\n"));
  })
  .listen(PORT);

async function fetchExcelAttachmentUrls() {
  const ARCHIVE_JSON_URL = "https://healthdata.gov/resource/6hii-ae4f.json";
  const response = await axios.get(ARCHIVE_JSON_URL);
  const lastReportIndex = response.data.length - 1;
  const lastReport = response.data[lastReportIndex];
  const metaDataPublished = JSON.parse(lastReport.metadata_published);
  const reportAttachments = metaDataPublished.attachments;
  const excelAttachments = reportAttachments.filter(({ filename }) =>
    filename.endsWith(".xlsx")
  );
  const getDownloadUrl = ({ assetId, filename }) =>
    `https://beta.healthdata.gov/api/views/gqxm-d9w9/files/${assetId}?download=true&filename=${filename}`;
  return excelAttachments.map(getDownloadUrl);
}
