import mongoose from 'mongoose';

let mode = 'unknown';

export function getDbMode() {
  return mode;
}

export async function connectDb() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is missing. Add it to backend/.env so accounts are kept.');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    mode = 'persistent';
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error(`MongoDB is not reachable (${err.message}). Accounts are not stored in a temporary database.`);
    process.exit(1);
  }
}
