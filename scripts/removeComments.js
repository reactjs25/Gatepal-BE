const fs = require('fs');
const path = require('path');
const strip = require('strip-comments');

const ROOT_DIR = path.join(__dirname, '..');

const DIRECTORIES_TO_PROCESS = [
  'controller',
  'middleware',
  'model',
  'routes',
  'utils',
  'config',
  'connectToDb',
  'jobs',
];

const FILES_TO_PROCESS = [
  'app.js',
  'server.js',
];

function removeCommentsFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const stripped = strip(content, { preserveNewlines: true });
    
    if (content !== stripped) {
      fs.writeFileSync(filePath, stripped, 'utf8');
      console.log(`Processed: ${path.relative(ROOT_DIR, filePath)}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return false;
  }
}

function processDirectory(dirPath) {
  let count = 0;
  
  if (!fs.existsSync(dirPath)) {
    return count;
  }

  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const itemPath = path.join(dirPath, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory()) {
      count += processDirectory(itemPath);
    } else if (item.endsWith('.js')) {
      if (removeCommentsFromFile(itemPath)) {
        count++;
      }
    }
  }
  
  return count;
}

function main() {
  console.log('Removing comments from JavaScript files...\n');
  
  let totalProcessed = 0;

  // Process directories
  for (const dir of DIRECTORIES_TO_PROCESS) {
    const dirPath = path.join(ROOT_DIR, dir);
    totalProcessed += processDirectory(dirPath);
  }

  // Process root files
  for (const file of FILES_TO_PROCESS) {
    const filePath = path.join(ROOT_DIR, file);
    if (fs.existsSync(filePath) && removeCommentsFromFile(filePath)) {
      totalProcessed++;
    }
  }

  console.log(`\nDone! Processed ${totalProcessed} file(s).`);
}

main();
