require('dotenv').config();

const { Client, collectPaginatedAPI } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_SECRET });

const axios = require('axios').default;
const sharp = require('sharp');
const { Readable } = require('stream');

const { BlobServiceClient, ContainerClient } = require("@azure/storage-blob");
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient('$web');

/**
 * @param binary Buffer
 * returns readableInstanceStream Readable
 */
 function bufferToStream(binary) {

  const readableInstanceStream = new Readable({
    read() {
      this.push(binary);
      this.push(null);
    }
  });

  return readableInstanceStream;
}

async function getContributions() {
  const d = new Date();
  const dateString = d.getFullYear().toString() + '-' + (d.getMonth()+1).toString().padStart(2, '0');
  const contributionsResponse = await collectPaginatedAPI(notion.databases.query, {database_id: process.env.NOTION_DATABASE_CONTRIBUTIONS});
  return contributionsResponse.filter(x => x.properties.Lifetime.checkbox === true || x.properties[dateString].checkbox === true).map(x => x.properties['💋 Companion'].relation[0].id);
}

async function getBannedKeywords()
{
  const bannedKeywordsResponse = await collectPaginatedAPI(notion.databases.query, {database_id: process.env.NOTION_DATABASE_KEYWORDS});
  return bannedKeywordsResponse.map(x => x.properties.Name.title[0].plain_text);
}

async function getCompanions(contributions, bannedKeywords) {
  const companionsResponse = await collectPaginatedAPI(notion.databases.query, { database_id: process.env.NOTION_DATABASE_COMPANIONS });
  const companions = companionsResponse.filter(x => contributions.includes(x.id) && x.properties.Picture.files.length > 0).map(x => ({id: x.id, name: x.properties.Name.title[0].plain_text, url: x.properties.Website.url, services: x.properties.Services.multi_select.map(y => y.name), race: x.properties.Race.multi_select.map(y => y.name), gender: x.properties.Gender.multi_select.map(y => y.name), catersto: x.properties['Caters to'].multi_select.map(y => y.name), age: x.properties.Age.multi_select.map(y => y.name), height: x.properties.Height.multi_select.map(y => y.name), tattoos: x.properties['Tattoos & mods'].multi_select.map(y => y.name), body_hair: x.properties['Body hair'].multi_select.map(y => y.name), tagline: x.properties.Tagline.rich_text.length > 0 ? x.properties.Tagline.rich_text[0].plain_text : null, keywords: x.properties.Keywords.rich_text.length > 0 ? x.properties.Keywords.rich_text[0].plain_text.toLowerCase() : null, location: x.properties.Location.multi_select.map(y => y.name)}))

  refreshCompanionPictures(companionsResponse);

  // Remove BannedKeywords
  bannedKeywords.forEach(function(bannedKeyword, i) {
    companions.forEach(function(companion, j) {
        if (companion.keywords != null && companion.keywords.includes(bannedKeyword))
        {
            console.log(`${bannedKeyword} + ${companion.name}`);
            companion.keywords = companion.keywords.replace(bannedKeyword, '');
        }
    });
  });

  return companions;
}

async function refreshCompanionPictures(companionsResponse) {
  // For each companion
  for (const companion of companionsResponse.filter(x => x.properties.Picture.files.length > 0))
  {
      const url = companion.properties.Picture.files[0].file.url;
      const blockBlobClient = containerClient.getBlockBlobClient(`img/companions/${companion.id}.jpg`);
      
      // Get picture from Notion
      const response = await axios.get(url, {responseType: "arraybuffer"});

      // Resize
      const resizedImage = await sharp(response.data)
      .resize({
        width: 500,
        height: 750,
        fit: sharp.fit.cover,
        position: sharp.strategy.entropy
      })
      .jpeg({quality: 85})
      .toBuffer();

      // Upload to Azure Storage
      const uploadResponse = await blockBlobClient.uploadStream(bufferToStream(resizedImage)); 
  };
}

async function main() {
  var contributions = await getContributions();
  var bannedKeywords = await getBannedKeywords();

  var companions = await getCompanions(contributions, bannedKeywords);
  var companionsString = JSON.stringify(companions);

  // Update main json file
  const blockBlobClient = containerClient.getBlockBlobClient('companions.json');
  await blockBlobClient.upload(companionsString, companionsString.length);

  console.log(companions);
}

main()
  .then(() => console.log("Done"))
  .catch((ex) => console.log(ex.message));
