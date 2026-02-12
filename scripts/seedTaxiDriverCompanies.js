/**
 * Seed script to insert taxi driver companies into MongoDB.
 *
 * Usage:
 *   node scripts/seedTaxiDriverCompanies.js
 *
 * Make sure your .env file has MONGO_URI set before running.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const TaxiDriverCompany = require('../model/taxiDriverCompanySchema');

const TAXI_COMPANIES = [
  'Blu smart',
  'Meru',
  'Ola',
  'Rapido',
  'Uber',
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

    const docs = TAXI_COMPANIES.map((name) => ({
      id: toId(name),
      name,
      imageUrl: '/assets/Default.png',
    }));

    let inserted = 0;
    let skipped = 0;

    for (const doc of docs) {
      try {
        await TaxiDriverCompany.create(doc);
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
    console.error('Failed to seed taxi driver companies:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

seed();
