// Script to resize bridge.png to required Chrome extension icon sizes
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '../public/bridge.png');
const outputDir = path.join(__dirname, '../public');

// Icon sizes required by Chrome extensions
const sizes = [16, 48, 128];

async function resizeIcon() {
  console.log('🎨 Resizing bridge.png for Chrome extension...\n');

  try {
    // Read PNG file
    const pngBuffer = fs.readFileSync(pngPath);

    // Resize to each required size
    for (const size of sizes) {
      const outputPath = path.join(outputDir, `bridge-icon-${size}.png`);

      await sharp(pngBuffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        })
        .png()
        .toFile(outputPath);

      console.log(`✅ Created ${size}x${size} icon: bridge-icon-${size}.png`);
    }

    console.log('\n🎉 All icons generated from bridge.png successfully!');
    console.log('\nFiles created:');
    console.log('  - public/bridge-icon-16.png');
    console.log('  - public/bridge-icon-48.png');
    console.log('  - public/bridge-icon-128.png');

  } catch (error) {
    console.error('❌ Error resizing icon:', error);
    process.exit(1);
  }
}

resizeIcon();
