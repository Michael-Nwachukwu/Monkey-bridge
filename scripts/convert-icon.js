// Script to convert SVG icon to PNG in multiple sizes for Chrome extension
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '../public/bridge.svg');
const outputDir = path.join(__dirname, '../public');

// Icon sizes required by Chrome extensions
const sizes = [16, 48, 128];

async function convertIcon() {
  console.log('🎨 Converting bridge.svg to PNG icons...\n');

  try {
    // Read SVG file
    const svgBuffer = fs.readFileSync(svgPath);

    // Convert to each size
    for (const size of sizes) {
      const outputPath = path.join(outputDir, `bridge-icon-${size}.png`);

      await sharp(svgBuffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        })
        .png()
        .toFile(outputPath);

      console.log(`✅ Created ${size}x${size} icon: bridge-icon-${size}.png`);
    }

    console.log('\n🎉 All icons generated successfully!');
    console.log('\nNext steps:');
    console.log('1. Update manifest.json to use new icons');
    console.log('2. Update build script to copy icons to dist/');
    console.log('3. Run npm run build');

  } catch (error) {
    console.error('❌ Error converting icon:', error);
    process.exit(1);
  }
}

convertIcon();
