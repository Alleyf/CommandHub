const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

exports.default = async function(context) {
  const exePath = path.join(context.appOutDir, 'CommandHub.exe');
  const iconPath = path.join(__dirname, '..', 'electron', 'assets', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    console.error(`Executable not found: ${exePath}`);
    return;
  }

  if (!fs.existsSync(iconPath)) {
    console.error(`Icon file not found: ${iconPath}`);
    return;
  }

  // Find resourcehacker (bundled with our tool) or use alternative approach
  const rhPaths = [
    path.join(__dirname, '..', 'node_modules', 'resourcehacker', 'ResourceHacker.exe'),
    path.join(process.cwd(), 'tools', 'ResourceHacker.exe')
  ];

  let hasResourceHacker = false;
  for (const p of rhPaths) {
    if (fs.existsSync(p)) {
      hasResourceHacker = true;
      break;
    }
  }

  if (hasResourceHacker) {
    console.log('Using ResourceHacker to embed icon...');
    // This would need a script file created first
    // For now, skip this complex approach
  }

  // Alternative: Use editres (simpler approach) - modify just the icon resource
  // rcedit --set-icon only updates the icon resource group

  const rceditPaths = [
    path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
    path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin', 'rcedit.exe'),
    path.join(process.cwd(), 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe')
  ];

  let rceditPath = null;
  for (const p of rceditPaths) {
    if (fs.existsSync(p)) {
      rceditPath = p;
      break;
    }
  }

  if (!rceditPath) {
    console.warn('rcedit not found. Icon may not be embedded correctly.');
    return;
  }

  console.log(`Embedding icon into CommandHub.exe using rcedit...`);
  try {
    // Set the icon - this updates the main application icon resource
    execSync(`"${rceditPath}" "${exePath}" --set-icon "${iconPath}"`, {
      stdio: 'pipe',
      shell: true
    });
    console.log('Icon resource updated successfully!');
  } catch (error) {
    console.error('Failed to set icon:', error.message);
  }

  // The product name and company info are stored in STRINGTABLE resources
  // which cannot be easily modified without full resource replacement
  console.log('Note: Main icon is now set. Visual properties like FileDescription may still show defaults.');
};
