/**
 * Seed script to insert other visitor companies into MongoDB.
 *
 * Usage:
 *   node scripts/seedOtherVisitorCompanies.js
 *
 * Make sure your .env file has MONGO_URI set before running.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const OtherVisitorCompany = require('../model/otherVisitorCompanySchema');

const OTHER_VISITOR_COMPANIES = [
  'Urban Company',
  'HouseJoy',
  'Helpr',
  'MrRight',
  'Sulekha Service Providers',
  'Justdial Service Providers',
  'Reliance JioFiber',
  'Bharti Airtel (Airtel Xstream)',
  'Vi (Vodafone Idea)',
  'BSNL Bharat Fiber',
  'ACT Fibernet',
  'Excitel Broadband',
  'Atria Convergence Technologies (ACT)',
  'YOU Broadband',
  'Pioneer Online',
  'Hathway Broadband',
  'Adani Power',
  'Tata Power',
  'NTPC Limited',
  'Power Grid Corporation of India',
  'NHPC Limited',
  'Gujarat Urja Vikas Nigam Ltd (state utility)',
  'BESCOM (Bangalore Electricity Supply Company)',
  'Torrent Power',
  'Uttar Pradesh Power Corporation Ltd',
  'Noida Power Company Ltd',
  'Dakshin Gujarat Vij Company Limited (DGVCL)',
  'Madhya Gujarat Vij Company Limited (MGVCL)',
  'Paschim Gujarat Vij Company Limited (PGVCL)',
  'Uttar Gujarat Vij Company Limited (UGVCL)',
  'LG',
  'Samsung',
  'Whirlpool',
  'IFB',
  'Bosch',
  'Voltas / Blue Star',
  'Hitachi',
  'Carrier',
  'Daikin',
  'Panasonic',
  'Vijay Sales',
  'Chroma',
  'Others',
];

const toId = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const seed = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const docs = OTHER_VISITOR_COMPANIES.map((name) => ({
      id: toId(name),
      name,
      imageUrl: '/assets/Default.png',
    }));

    let inserted = 0;
    let skipped = 0;

    for (const doc of docs) {
      try {
        await OtherVisitorCompany.create(doc);
        inserted++;
        console.log(`  Inserted: ${doc.name}`);
      } catch (err) {
        if (err.code === 11000) {
          skipped++;
          console.log(`  Skipped (already exists): ${doc.name}`);
        } else {
          console.error(`  Error inserting ${doc.name}:`, err.message);
        }
      }
    }

    console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}`);
  } catch (err) {
    console.error('Failed to seed other visitor companies:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

seed();
