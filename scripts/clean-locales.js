const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  // electron-builder context object
  // context.appOutDir is the unpacked directory path
  // context.packager.appInfo.productName is the app name
  
  const localesDir = path.join(context.appOutDir, 'locales');
  
  // If the locales directory doesn't exist, skip
  if (!fs.existsSync(localesDir)) {
    return;
  }

  // Define which locales to keep
  const keepLocales = [
    'en-US.pak',
    'zh-CN.pak', 
    'zh-TW.pak'
  ];

  try {
    const files = fs.readdirSync(localesDir);
    let removedCount = 0;

    for (const file of files) {
      if (file.endsWith('.pak') && !keepLocales.includes(file)) {
        fs.unlinkSync(path.join(localesDir, file));
        removedCount++;
      }
    }
    
    console.log(`Removed ${removedCount} unused locale files.`);
  } catch (error) {
    console.error('Error cleaning locales:', error);
  }
};
